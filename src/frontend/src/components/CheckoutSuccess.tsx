import { useEffect } from 'react';
import axios from 'axios';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from 'react-query';
import { api } from '../api/config';
import { useCart } from '../context/CartContext';
import { useTheme } from '../context/ThemeContext';

interface CheckoutStatus {
  status: 'pending' | 'paid' | 'failed';
  orderId?: number;
}

export default function CheckoutSuccess() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const { clearCart } = useCart();
  const { darkMode } = useTheme();
  const { data, isLoading, isError } = useQuery<CheckoutStatus>(
    ['checkout-status', sessionId],
    async () => {
      const response = await axios.get(
        `${api.baseURL}${api.endpoints.checkoutSessions}/${encodeURIComponent(sessionId || '')}`,
      );
      return response.data;
    },
    { enabled: Boolean(sessionId), refetchInterval: (status) => (status?.status === 'pending' ? 2000 : false) },
  );

  useEffect(() => {
    if (data?.status === 'paid') clearCart();
  }, [data?.status, clearCart]);

  const textColor = darkMode ? 'text-light' : 'text-gray-800';
  let message = 'Checking your payment…';
  if (!sessionId || isError) message = 'We could not confirm this payment. Your cart has been kept.';
  else if (!isLoading && data?.status === 'paid') message = `Payment confirmed. Your order number is ${data.orderId}.`;
  else if (data?.status === 'failed') message = 'Payment was declined or expired. Your cart is unchanged; please try again.';
  else if (data?.status === 'pending') message = 'Payment confirmation is pending. This page will update automatically.';

  return (
    <section className={`min-h-screen ${darkMode ? 'bg-dark' : 'bg-gray-100'} pt-24 pb-16 px-4`}>
      <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} max-w-2xl mx-auto rounded-lg p-8 text-center`}>
        <h1 className={`text-3xl font-bold ${textColor} mb-4`}>Checkout status</h1>
        <p role={data?.status === 'failed' || isError ? 'alert' : 'status'} className={`${textColor} mb-6`}>
          {message}
        </p>
        {(data?.status !== 'paid' || isError || !sessionId) && (
          <Link to="/cart" className="text-primary hover:underline">Return to cart</Link>
        )}
        {data?.status === 'paid' && <Link to="/products" className="text-primary hover:underline">Continue shopping</Link>}
      </div>
    </section>
  );
}
