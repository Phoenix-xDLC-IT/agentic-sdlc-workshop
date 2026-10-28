import { useState } from 'react';
import axios from 'axios';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/config';
import { useCart } from '../context/CartContext';
import { useTheme } from '../context/ThemeContext';

interface CheckoutSessionQuote {
  id: string;
  url: string;
  items: Array<{ productId: number; quantity: number; name: string; unitPrice: number }>;
  amountInCents: number;
}

export default function Checkout() {
  const { items, subtotal } = useCart();
  const { darkMode } = useTheme();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [session, setSession] = useState<CheckoutSessionQuote | null>(null);

  const preparePayment = async () => {
    setError('');
    setIsSubmitting(true);
    try {
      const { data } = await axios.post<CheckoutSessionQuote>(
        `${api.baseURL}${api.endpoints.checkoutSessions}`,
        {
          items: items.map(({ productId, quantity }) => ({ productId, quantity })),
        },
      );
      if (
        typeof data.url !== 'string' ||
        !data.url.startsWith('https://checkout.stripe.com/') ||
        !Number.isSafeInteger(data.amountInCents) ||
        !Array.isArray(data.items)
      ) {
        throw new Error('Payment provider returned an invalid checkout session.');
      }
      setSession(data);
    } catch {
      setError('We could not prepare your payment. Please try again; your cart is unchanged.');
      setIsSubmitting(false);
      return;
    }
    setIsSubmitting(false);
  };

  const continueToPayment = () => {
    if (!session) {
      return;
    }
    setIsSubmitting(true);
    window.location.assign(session.url);
  };

  const textColor = darkMode ? 'text-light' : 'text-gray-800';
  const displayItems = session?.items || items.map((item) => ({
    ...item,
    unitPrice: Math.round(item.price * (1 - (item.discount || 0)) * 100) / 100,
  }));
  const displayTotal = session ? session.amountInCents / 100 : subtotal;
  return (
    <section className={`min-h-screen ${darkMode ? 'bg-dark' : 'bg-gray-100'} pt-24 pb-16 px-4`}>
      <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} max-w-2xl mx-auto rounded-lg p-6`}>
        <h1 className={`text-3xl font-bold ${textColor} mb-6`}>Secure Checkout</h1>
        {searchParams.get('cancelled') && (
          <p role="status" className="mb-4 rounded bg-yellow-100 p-3 text-yellow-900">
            Payment was canceled. Your cart is unchanged.
          </p>
        )}
        {error && <p role="alert" className="mb-4 rounded bg-red-100 p-3 text-red-800">{error}</p>}
        {items.length === 0 ? (
          <div>
            <p className={`${textColor} mb-4`}>Your cart is empty.</p>
            <Link to="/products" className="text-primary hover:underline">Browse products</Link>
          </div>
        ) : (
          <>
            <p className={`${textColor} mb-4`}>
              {session
                ? 'Confirm the current prices before continuing to secure payment.'
                : 'Review your estimated order total; current prices are confirmed before payment.'}
            </p>
            <ul className={`divide-y ${darkMode ? 'divide-gray-700' : 'divide-gray-200'}`}>
              {displayItems.map((item) => (
                <li key={item.productId} className={`flex justify-between py-3 ${textColor}`}>
                  <span>{item.name} × {item.quantity}</span>
                  <span>
                    ${(item.unitPrice * item.quantity).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
            <p className={`mt-4 text-right text-xl font-bold ${textColor}`}>
              {session ? 'Confirmed total' : 'Estimated total'}: ${displayTotal.toFixed(2)}
            </p>
            <p className="mt-3 text-sm text-gray-500">Payment details are collected securely by Stripe.</p>
            <div className="mt-6 flex justify-between gap-4">
              <Link to="/cart" className="rounded border border-gray-400 px-5 py-3">Back to cart</Link>
              <button
                type="button"
                onClick={session ? continueToPayment : preparePayment}
                disabled={isSubmitting}
                className="rounded bg-primary px-6 py-3 font-semibold text-white hover:bg-accent disabled:opacity-60"
              >
                {isSubmitting
                  ? session
                    ? 'Opening secure payment…'
                    : 'Preparing payment…'
                  : session
                    ? 'Continue to secure payment'
                    : 'Review total and prepare payment'}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
