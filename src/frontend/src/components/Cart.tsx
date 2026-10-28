import { Link } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useTheme } from '../context/ThemeContext';

export default function Cart() {
  const { items, subtotal, setQuantity, removeItem } = useCart();
  const { darkMode } = useTheme();
  const textColor = darkMode ? 'text-light' : 'text-gray-800';

  return (
    <section className={`min-h-screen ${darkMode ? 'bg-dark' : 'bg-gray-100'} pt-24 pb-16 px-4`}>
      <div className="max-w-4xl mx-auto">
        <h1 className={`text-3xl font-bold ${textColor} mb-8`}>Your Cart</h1>
        {items.length === 0 ? (
          <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg p-8 text-center`}>
            <p className={`${textColor} mb-5`}>Your cart is empty.</p>
            <Link to="/products" className="text-primary hover:underline">Browse products</Link>
          </div>
        ) : (
          <>
            <ul className="space-y-4">
              {items.map((item) => {
                const unitPrice = Math.round(item.price * (1 - (item.discount || 0)) * 100) / 100;
                return (
                  <li
                    key={item.productId}
                    className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg p-4 flex flex-wrap items-center gap-4`}
                  >
                    <img src={`/${item.imgName}`} alt="" className="h-16 w-16 object-contain" />
                    <div className="flex-1 min-w-32">
                      <h2 className={`font-semibold ${textColor}`}>{item.name}</h2>
                      <p className="text-primary">${unitPrice.toFixed(2)} each</p>
                    </div>
                    <label className={textColor}>
                      Quantity
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={item.quantity}
                        onChange={(event) => setQuantity(item.productId, Number(event.target.value))}
                        className="ml-2 w-20 rounded border px-2 py-1 text-gray-800"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeItem(item.productId)}
                      className="text-red-600 hover:underline"
                      aria-label={`Remove ${item.name}`}
                    >
                      Remove
                    </button>
                    <span className={`w-24 text-right font-semibold ${textColor}`}>
                      ${(unitPrice * item.quantity).toFixed(2)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
              <p className={`text-xl font-bold ${textColor}`}>Subtotal: ${subtotal.toFixed(2)}</p>
              <Link to="/checkout" className="rounded bg-primary px-6 py-3 font-semibold text-white hover:bg-accent">
                Continue to checkout
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
