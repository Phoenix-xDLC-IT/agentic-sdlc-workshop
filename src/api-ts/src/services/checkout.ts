import { createHmac, timingSafeEqual } from 'crypto';
import { DatabaseConnection, getDatabase } from '../db/sqlite';
import { DatabaseError, NotFoundError, ValidationError } from '../utils/errors';

interface CheckoutRequestItem {
  productId: number;
  quantity: number;
}

interface CheckoutItem extends CheckoutRequestItem {
  name: string;
  unitPrice: number;
}

interface CheckoutSession {
  session_id: string;
  branch_id: number;
  items: string;
  status: 'pending' | 'paid' | 'failed';
  order_id: number | null;
}

interface StripeSession {
  id: string;
  url?: string | null;
  payment_status?: string;
  status?: string;
}

interface StripeEvent {
  type: string;
  data?: { object?: StripeSession };
}

function paymentConfig() {
  if ((process.env.PAYMENT_PROVIDER || 'stripe').toLowerCase() !== 'stripe') {
    throw new DatabaseError('The configured payment provider is not supported.', 'PAYMENT_CONFIGURATION_ERROR', 503);
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new DatabaseError('Payment is temporarily unavailable.', 'PAYMENT_CONFIGURATION_ERROR', 503);
  }

  return secretKey;
}

function normalizeItems(input: unknown): CheckoutRequestItem[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 100) {
    throw new ValidationError('Cart must contain between 1 and 100 products.');
  }

  const quantities = new Map<number, number>();
  for (const item of input) {
    if (
      !item ||
      !Number.isSafeInteger(item.productId) ||
      item.productId <= 0 ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity <= 0 ||
      item.quantity > 100
    ) {
      throw new ValidationError('Each cart item must have a valid product and quantity.');
    }

    const quantity = (quantities.get(item.productId) || 0) + item.quantity;
    if (quantity > 100) {
      throw new ValidationError('Product quantity cannot exceed 100.');
    }
    quantities.set(item.productId, quantity);
  }

  return [...quantities].map(([productId, quantity]) => ({ productId, quantity }));
}

async function stripeRequest<T>(path: string, method: 'GET' | 'POST', body?: URLSearchParams): Promise<T> {
  const secretKey = paymentConfig();
  let response: Response;
  try {
    response = await fetch(`https://api.stripe.com/v1/${path}`, {
      method,
      headers: {
        Authorization: 'Bearer ' + secretKey,
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(body ? { body: body.toString() } : {}),
    });
  } catch {
    throw new DatabaseError('Payment could not be processed. Please try again.', 'PAYMENT_PROVIDER_ERROR', 502);
  }

  if (!response.ok) {
    throw new DatabaseError('Payment could not be processed. Please try again.', 'PAYMENT_PROVIDER_ERROR', 502);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new DatabaseError('Payment provider returned an invalid response.', 'PAYMENT_PROVIDER_ERROR', 502);
  }
}

async function createOrderForPaidSession(db: DatabaseConnection, sessionId: string): Promise<number> {
  return db.db.transaction(() => {
    const session = db.db
      .prepare('SELECT * FROM checkout_sessions WHERE session_id = ?')
      .get(sessionId) as CheckoutSession | undefined;

    if (!session) {
      throw new NotFoundError('Checkout session', sessionId);
    }
    if (session.status === 'paid' && session.order_id) {
      return session.order_id;
    }

    const items = JSON.parse(session.items) as CheckoutItem[];
    const orderResult = db.db
      .prepare(
        `INSERT INTO orders (branch_id, order_date, name, description, status)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        session.branch_id,
        new Date().toISOString(),
        'Customer checkout',
        `Paid via Stripe checkout session ${sessionId}`,
        'processing',
      );
    const orderId = Number(orderResult.lastInsertRowid);
    const insertDetail = db.db.prepare(
      'INSERT INTO order_details (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
    );

    for (const item of items) {
      insertDetail.run(orderId, item.productId, item.quantity, item.unitPrice);
    }

    db.db
      .prepare("UPDATE checkout_sessions SET status = 'paid', order_id = ? WHERE session_id = ?")
      .run(orderId, sessionId);
    return orderId;
  })();
}

async function markSessionFailed(db: DatabaseConnection, sessionId: string): Promise<void> {
  await db.run(
    "UPDATE checkout_sessions SET status = 'failed' WHERE session_id = ? AND status = 'pending'",
    [sessionId],
  );
}

export async function createCheckoutSession(input: unknown): Promise<{ id: string; url: string }> {
  const requestItems = normalizeItems(input);
  const db = await getDatabase();
  const branchId = Number(process.env.CHECKOUT_BRANCH_ID || 1);
  const branch = await db.get<{ branch_id: number }>('SELECT branch_id FROM branches WHERE branch_id = ?', [
    branchId,
  ]);
  if (!Number.isSafeInteger(branchId) || !branch) {
    throw new DatabaseError('Checkout is not configured for a valid branch.', 'CHECKOUT_CONFIGURATION_ERROR', 503);
  }

  const products = await db.all<{
    product_id: number;
    name: string;
    price: number;
    discount: number | null;
  }>(
    `SELECT product_id, name, price, discount FROM products
     WHERE product_id IN (${requestItems.map(() => '?').join(', ')})`,
    requestItems.map((item) => item.productId),
  );
  if (products.length !== requestItems.length) {
    throw new ValidationError('One or more products in your cart are no longer available.');
  }

  const items = requestItems.map((requested): CheckoutItem => {
    const product = products.find((candidate) => candidate.product_id === requested.productId);
    if (!product || !Number.isFinite(product.price) || product.price <= 0) {
      throw new ValidationError('One or more products in your cart cannot be purchased.');
    }
    const discount = product.discount || 0;
    if (!Number.isFinite(discount) || discount < 0 || discount > 1) {
      throw new ValidationError('Product pricing is invalid.');
    }
    return {
      ...requested,
      name: product.name,
      unitPrice: Math.round(product.price * (1 - discount) * 100) / 100,
    };
  });

  const currency = (process.env.PAYMENT_CURRENCY || 'USD').toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) {
    throw new DatabaseError('Payment currency is not configured correctly.', 'PAYMENT_CONFIGURATION_ERROR', 503);
  }

  const frontendUrl = new URL(process.env.CHECKOUT_FRONTEND_URL || 'http://localhost:5137');
  if (!['http:', 'https:'].includes(frontendUrl.protocol)) {
    throw new DatabaseError('Checkout URL is not configured correctly.', 'PAYMENT_CONFIGURATION_ERROR', 503);
  }
  const successUrl = new URL('/checkout/success', frontendUrl);
  successUrl.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}');
  const cancelUrl = new URL('/checkout', frontendUrl);
  cancelUrl.searchParams.set('cancelled', '1');

  const body = new URLSearchParams({
    mode: 'payment',
    success_url: successUrl.toString(),
    cancel_url: cancelUrl.toString(),
  });
  body.set('payment_method_types[0]', 'card');
  items.forEach((item, index) => {
    body.set(`line_items[${index}][price_data][currency]`, currency);
    body.set(`line_items[${index}][price_data][unit_amount]`, String(Math.round(item.unitPrice * 100)));
    body.set(`line_items[${index}][price_data][product_data][name]`, item.name);
    body.set(`line_items[${index}][quantity]`, String(item.quantity));
  });

  const session = await stripeRequest<StripeSession>('checkout/sessions', 'POST', body);
  if (!session.id || !session.url || !session.url.startsWith('https://checkout.stripe.com/')) {
    throw new DatabaseError('Payment provider returned an invalid checkout session.', 'PAYMENT_PROVIDER_ERROR', 502);
  }

  await db.run(
    'INSERT INTO checkout_sessions (session_id, branch_id, items) VALUES (?, ?, ?)',
    [session.id, branchId, JSON.stringify(items)],
  );

  return { id: session.id, url: session.url };
}

export async function getCheckoutStatus(
  sessionId: string,
): Promise<{ status: 'pending' | 'paid' | 'failed'; orderId?: number }> {
  const db = await getDatabase();
  const stored = await db.get<CheckoutSession>('SELECT * FROM checkout_sessions WHERE session_id = ?', [sessionId]);
  if (!stored) {
    throw new NotFoundError('Checkout session', sessionId);
  }
  if (stored.status === 'paid' && stored.order_id) {
    return { status: 'paid', orderId: stored.order_id };
  }
  if (stored.status === 'failed') {
    return { status: 'failed' };
  }

  const session = await stripeRequest<StripeSession>(
    `checkout/sessions/${encodeURIComponent(sessionId)}`,
    'GET',
  );
  if (session.payment_status === 'paid') {
    const orderId = await createOrderForPaidSession(db, sessionId);
    return { status: 'paid', orderId };
  }
  if (session.status === 'expired') {
    await markSessionFailed(db, sessionId);
    return { status: 'failed' };
  }
  return { status: 'pending' };
}

export async function handleStripeWebhook(
  rawBody: Buffer,
  signature: string | undefined,
): Promise<void> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new DatabaseError('Payment confirmation is not configured.', 'PAYMENT_CONFIGURATION_ERROR', 503);
  }
  if (!signature) {
    throw new ValidationError('Missing payment signature.');
  }

  const parts = signature.split(',').reduce<Record<string, string[]>>((values, part) => {
    const [key, value] = part.split('=', 2);
    if (key && value) values[key] = [...(values[key] || []), value];
    return values;
  }, {});
  const timestamp = Number(parts.t?.[0]);
  const signatures = parts.v1 || [];
  const signedPayload = `${parts.t?.[0]}.${rawBody.toString('utf8')}`;
  const expected = createHmac('sha256', secret).update(signedPayload).digest();
  const validSignature = signatures.some((value) => {
    if (!/^[a-f\d]{64}$/i.test(value)) return false;
    return timingSafeEqual(expected, Buffer.from(value, 'hex'));
  });
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(Date.now() / 1000 - timestamp) > 300 ||
    !validSignature
  ) {
    throw new ValidationError('Invalid payment signature.');
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody.toString('utf8')) as StripeEvent;
  } catch {
    throw new ValidationError('Invalid payment event.');
  }

  const sessionId = event.data?.object?.id;
  if (!sessionId) return;

  const db = await getDatabase();
  if (event.type === 'checkout.session.completed' && event.data?.object?.payment_status === 'paid') {
    await createOrderForPaidSession(db, sessionId);
  } else if (
    event.type === 'checkout.session.expired' ||
    event.type === 'checkout.session.async_payment_failed'
  ) {
    await markSessionFailed(db, sessionId);
  }
}
