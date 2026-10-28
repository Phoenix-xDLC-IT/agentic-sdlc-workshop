import { useState } from 'react';
import axios from 'axios';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/config';
import { useCart } from '../context/CartContext';
import { useTheme } from '../context/ThemeContext';

export default function Checkout() {
  const { items, subtotal } = useCart();
  const { darkMode } = useTheme();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const startPayment = async () => {
    setError('');
    setIsSubmitting(true);
    try {
      const { data } = await axios.post(`${api.baseURL}${api.endpoints.checkoutSessions}`, {
        items: items.map(({ productId, quantity }) => ({ productId, quantity })),
      });
      if (typeof data.url !== 'string' || !data.url.startsWith('https://checkout.stripe.com/')) {
        throw new Error('Payment provider returned an invalid checkout link.');
      }
      window.location.assign(data.url);
    } catch {
      setError('We could not start your payment. Please try again; your cart is unchanged.');
      setIsSubmitting(false);
    }
  };

  const textColor = darkMode ? 'text-light' : 'text-gray-800';
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
            <p className={`${textColor} mb-4`}>Review your order before continuing to secure payment.</p>
            <ul className={`divide-y ${darkMode ? 'divide-gray-700' : 'divide-gray-200'}`}>
              {items.map((item) => (
                <li key={item.productId} className={`flex justify-between py-3 ${textColor}`}>
                  <span>{item.name} × {item.quantity}</span>
                  <span>
                    ${((Math.round(item.price * (1 - (item.discount || 0)) * 100) / 100) * item.quantity).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
            <p className={`mt-4 text-right text-xl font-bold ${textColor}`}>Total: ${subtotal.toFixed(2)}</p>
            <p className="mt-3 text-sm text-gray-500">Payment details are collected securely by Stripe.</p>
            <div className="mt-6 flex justify-between gap-4">
              <Link to="/cart" className="rounded border border-gray-400 px-5 py-3">Back to cart</Link>
              <button
                type="button"
                onClick={startPayment}
                disabled={isSubmitting}
                className="rounded bg-primary px-6 py-3 font-semibold text-white hover:bg-accent disabled:opacity-60"
              >
                {isSubmitting ? 'Connecting to payment…' : 'Pay securely'}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
