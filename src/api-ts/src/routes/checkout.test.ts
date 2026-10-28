import { createHmac } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import checkoutRouter from './checkout';
import { runMigrations } from '../db/migrate';
import { closeDatabase, getDatabase } from '../db/sqlite';
import { errorHandler } from '../utils/errors';

let app: express.Express;
function paymentResponse(data: unknown, ok = true) {
  return { ok, json: async () => data } as Response;
}

describe('Checkout API', () => {
  beforeEach(async () => {
    await closeDatabase();
    await getDatabase(true);
    await runMigrations(true);
    const db = await getDatabase();
    await db.run('INSERT INTO headquarters (headquarters_id, name) VALUES (1, ?)', ['HQ']);
    await db.run(
      'INSERT INTO branches (branch_id, headquarters_id, name) VALUES (1, 1, ?)',
      ['Main branch'],
    );
    await db.run('INSERT INTO suppliers (supplier_id, name) VALUES (1, ?)', ['Supplier']);
    await db.run(
      'INSERT INTO products (product_id, supplier_id, name, description, price, sku, unit, img_name, discount) VALUES (1, 1, ?, ?, 20, ?, ?, ?, 0.1)',
      ['Cat feeder', 'Smart feeder', 'FEEDER-1', 'each', 'feeder.png'],
    );

    vi.stubEnv('PAYMENT_PROVIDER', 'stripe');
    vi.stubEnv('STRIPE_SECRET_KEY', 'test-secret');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'test-webhook-secret');
    vi.stubEnv('CHECKOUT_BRANCH_ID', '1');

    app = express();
    app.use(
      express.json({
        verify: (req, _res, buffer) => {
          (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
        },
      }),
    );
    app.use('/api/checkout', checkoutRouter);
    app.use(errorHandler);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await closeDatabase();
  });

  it('creates a hosted session and confirms payment as one complete order', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(paymentResponse({ id: 'cs_test_paid', url: 'https://checkout.stripe.com/pay/cs_test_paid' }))
      .mockResolvedValueOnce(paymentResponse({ id: 'cs_test_paid', payment_status: 'paid' }));
    vi.stubGlobal('fetch', fetchMock);

    const created = await request(app)
      .post('/api/checkout/sessions')
      .send({ items: [{ productId: 1, quantity: 2 }] });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      id: 'cs_test_paid',
      url: 'https://checkout.stripe.com/pay/cs_test_paid',
      amountInCents: 3600,
      items: [{ productId: 1, quantity: 2, name: 'Cat feeder', unitPrice: 18 }],
    });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer ' + 'test-secret');
    expect(fetchMock.mock.calls[0][1].body).toContain('unit_amount%5D=1800');

    const confirmed = await request(app).get('/api/checkout/sessions/cs_test_paid');
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({
      status: 'paid',
      orderId: expect.any(Number),
      items: [{ productId: 1, quantity: 2 }],
    });

    const db = await getDatabase();
    const orders = await db.all<{ order_id: number }>('SELECT order_id FROM orders');
    const details = await db.all<{ product_id: number; quantity: number; unit_price: number }>(
      'SELECT product_id, quantity, unit_price FROM order_details',
    );
    expect(orders).toHaveLength(1);
    expect(details).toEqual([{ product_id: 1, quantity: 2, unit_price: 18 }]);
  });

  it('keeps an expired checkout failed without creating an order', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(paymentResponse({ id: 'cs_test_expired', url: 'https://checkout.stripe.com/pay/cs_test_expired' }))
      .mockResolvedValueOnce(paymentResponse({ id: 'cs_test_expired', payment_status: 'unpaid', status: 'expired' }));
    vi.stubGlobal('fetch', fetchMock);

    const created = await request(app)
      .post('/api/checkout/sessions')
      .send({ items: [{ productId: 1, quantity: 1 }] });
    expect(created.status).toBe(201);

    const result = await request(app).get('/api/checkout/sessions/cs_test_expired');
    expect(result.body).toEqual({ status: 'failed' });
    const db = await getDatabase();
    expect(await db.get('SELECT order_id FROM orders')).toBeUndefined();
  });

  it('rejects invalid carts without contacting the payment provider', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app)
      .post('/api/checkout/sessions')
      .send({ items: [{ productId: 1, quantity: 0 }] });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('verifies signed webhooks and does not create duplicate orders', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      paymentResponse({ id: 'cs_test_webhook', url: 'https://checkout.stripe.com/pay/cs_test_webhook' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await request(app)
      .post('/api/checkout/sessions')
      .send({ items: [{ productId: 1, quantity: 1 }] });

    const timestamp = Math.floor(Date.now() / 1000);
    const event = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_webhook', payment_status: 'paid' } },
    });
    const signature = createHmac('sha256', 'test-webhook-secret')
      .update(`${timestamp}.${event}`)
      .digest('hex');
    const postEvent = () =>
      request(app)
        .post('/api/checkout/webhook')
        .set('stripe-signature', `t=${timestamp},v1=${signature}`)
        .set('Content-Type', 'application/json')
        .send(event);

    expect((await postEvent()).status).toBe(200);
    expect((await postEvent()).status).toBe(200);
    const db = await getDatabase();
    const orders = await db.all<{ order_id: number }>('SELECT order_id FROM orders');
    expect(orders).toHaveLength(1);
  });

  it('rejects webhooks with an invalid signature', async () => {
    const event = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_invalid', payment_status: 'paid' } },
    });
    const response = await request(app)
      .post('/api/checkout/webhook')
      .set('stripe-signature', `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`)
      .set('Content-Type', 'application/json')
      .send(event);

    expect(response.status).toBe(400);
    expect(await (await getDatabase()).get('SELECT order_id FROM orders')).toBeUndefined();
  });
});
