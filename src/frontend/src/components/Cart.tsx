import { Link } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useCart } from '../hooks/useCart';
import { MAX_CART_QUANTITY } from '../types/cart';

const money = (value: number) => `$${value.toFixed(2)}`;

export default function CartPage() {
  const { darkMode } = useTheme();
  const { data: cart, isLoading, error, updateItem, removeItem } = useCart();

  const pending = updateItem.isLoading || removeItem.isLoading;
  const mutationFailed = updateItem.isError || removeItem.isError;
  const text = darkMode ? 'text-light' : 'text-gray-800';
  const muted = darkMode ? 'text-gray-400' : 'text-gray-600';
  const card = `${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} rounded-lg border shadow-sm`;

  return (
    <div
      className={`min-h-screen ${darkMode ? 'bg-dark' : 'bg-gray-100'} pt-20 pb-16 px-4 transition-colors duration-300`}
    >
      <div className="max-w-4xl mx-auto space-y-6">
        <h1 className={`text-3xl font-bold ${text}`}>Your Cart</h1>

        {isLoading && <p className={muted}>Loading cart...</p>}
        {error != null && <div className="text-red-500">Failed to load cart</div>}
        {mutationFailed && (
          <div role="alert" className="text-red-500">
            Could not update the cart. Please try again.
          </div>
        )}

        {cart && cart.items.length === 0 && (
          <div className={`${card} text-center py-16`} data-testid="cart-empty">
            <p className={`${text} text-lg font-medium`}>Your cart is empty</p>
            <Link to="/products" className="text-primary hover:text-accent mt-2 inline-block">
              Browse products
            </Link>
          </div>
        )}

        {cart && cart.items.length > 0 && (
          <>
            <ul className="space-y-4">
              {cart.items.map((item) => (
                <li
                  key={item.productId}
                  className={`${card} p-4 flex flex-wrap items-center gap-4`}
                  data-testid={`cart-item-${item.productId}`}
                >
                  {item.imgName && (
                    <img src={`/${item.imgName}`} alt={item.name} className="h-16 w-16 object-contain" />
                  )}
                  <div className="flex-grow min-w-[10rem]">
                    <h2 className={`font-semibold ${text}`}>{item.name}</h2>
                    <p className={`text-sm ${muted}`}>
                      {item.discount > 0 && (
                        <span className="line-through mr-2">{money(item.price)}</span>
                      )}
                      {money(item.unitPrice)} / {item.unit}
                    </p>
                  </div>
                  <div
                    className={`flex items-center space-x-3 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-lg p-1`}
                  >
                    <button
                      className={`w-8 h-8 ${text} hover:text-primary disabled:opacity-40`}
                      aria-label={`Decrease quantity of ${item.name}`}
                      disabled={pending || item.quantity <= 1}
                      onClick={() =>
                        updateItem.mutate({ productId: item.productId, quantity: item.quantity - 1 })
                      }
                    >
                      <span aria-hidden="true">-</span>
                    </button>
                    <span
                      className={`${text} min-w-[2rem] text-center`}
                      aria-label={`Quantity of ${item.name}`}
                    >
                      {item.quantity}
                    </span>
                    <button
                      className={`w-8 h-8 ${text} hover:text-primary disabled:opacity-40`}
                      aria-label={`Increase quantity of ${item.name}`}
                      disabled={pending || item.quantity >= MAX_CART_QUANTITY}
                      onClick={() =>
                        updateItem.mutate({ productId: item.productId, quantity: item.quantity + 1 })
                      }
                    >
                      <span aria-hidden="true">+</span>
                    </button>
                  </div>
                  <span className={`w-24 text-right font-semibold ${text}`} data-testid="line-total">
                    {money(item.lineTotal)}
                  </span>
                  <button
                    className="text-red-500 hover:text-red-400 disabled:opacity-40"
                    aria-label={`Remove ${item.name} from cart`}
                    disabled={pending}
                    onClick={() => removeItem.mutate(item.productId)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>

            <div className={`${card} p-4 flex justify-between items-center`}>
              <span className={muted}>
                Subtotal ({cart.itemCount} {cart.itemCount === 1 ? 'item' : 'items'})
              </span>
              <span className="text-primary text-2xl font-bold" data-testid="cart-subtotal">
                {money(cart.subtotal)}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
