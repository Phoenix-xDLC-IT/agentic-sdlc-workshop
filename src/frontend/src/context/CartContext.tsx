import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export interface CartProduct {
  productId: number;
  name: string;
  description: string;
  price: number;
  imgName: string;
  discount?: number;
}

export interface CartItem extends CartProduct {
  quantity: number;
}

interface CartContextValue {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  addItem: (product: CartProduct, quantity: number) => void;
  setQuantity: (productId: number, quantity: number) => void;
  removeItem: (productId: number) => void;
  removePurchasedItems: (
    sessionId: string,
    purchasedItems: Array<{ productId: number; quantity: number }>,
  ) => void;
}

const CartContext = createContext<CartContextValue | null>(null);
const STORAGE_KEY = 'octocat-cart';
const PROCESSED_CHECKOUTS_KEY = 'octocat-processed-checkouts';

function loadCart(): CartItem[] {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as unknown;
    if (!Array.isArray(stored)) {
      return [];
    }
    return stored.filter(
      (item): item is CartItem =>
        item &&
        Number.isSafeInteger(item.productId) &&
        typeof item.name === 'string' &&
        Number.isFinite(item.price) &&
        item.price > 0 &&
        (item.discount === undefined ||
          (Number.isFinite(item.discount) && item.discount >= 0 && item.discount <= 1)) &&
        Number.isSafeInteger(item.quantity) &&
        item.quantity > 0 &&
        item.quantity <= 100,
    ).slice(0, 100);
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(loadCart);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  useEffect(() => {
    const syncCart = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) {
        setItems(loadCart());
      }
    };
    window.addEventListener('storage', syncCart);
    return () => window.removeEventListener('storage', syncCart);
  }, []);

  const addItem = (product: CartProduct, quantity: number) => {
    if (quantity <= 0) {
      return;
    }
    setItems((current) => {
      const existing = current.find((item) => item.productId === product.productId);
      return existing
        ? current.map((item) =>
            item.productId === product.productId
              ? { ...product, quantity: Math.min(100, item.quantity + quantity) }
              : item,
          )
        : [...current, { ...product, quantity: Math.min(100, quantity) }];
    });
  };

  const setQuantity = (productId: number, quantity: number) => {
    if (quantity <= 0) {
      setItems((current) => current.filter((item) => item.productId !== productId));
      return;
    }
    setItems((current) =>
      current.map((item) =>
        item.productId === productId ? { ...item, quantity: Math.min(100, quantity) } : item,
      ),
    );
  };

  const removeItem = (productId: number) => {
    setItems((current) => current.filter((item) => item.productId !== productId));
  };
  const removePurchasedItems = useCallback(
    (sessionId: string, purchasedItems: Array<{ productId: number; quantity: number }>) => {
      try {
        const processed = JSON.parse(localStorage.getItem(PROCESSED_CHECKOUTS_KEY) || '[]') as unknown;
        if (Array.isArray(processed) && processed.includes(sessionId)) {
          return;
        }
        const processedSessions = Array.isArray(processed)
          ? processed.filter((id): id is string => typeof id === 'string')
          : [];
        localStorage.setItem(
          PROCESSED_CHECKOUTS_KEY,
          JSON.stringify([...processedSessions, sessionId].slice(-50)),
        );
      } catch {
        // Continue clearing purchased quantities if storage is unavailable.
      }

      const purchasedQuantities = new Map<number, number>();
      for (const item of purchasedItems) {
        if (
          Number.isSafeInteger(item.productId) &&
          Number.isSafeInteger(item.quantity) &&
          item.quantity > 0
        ) {
          purchasedQuantities.set(
            item.productId,
            (purchasedQuantities.get(item.productId) || 0) + item.quantity,
          );
        }
      }

      const updatedCart = loadCart().flatMap((item) => {
          const remaining = item.quantity - (purchasedQuantities.get(item.productId) || 0);
          return remaining > 0 ? [{ ...item, quantity: remaining }] : [];
      });
      setItems(updatedCart);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedCart));
      } catch {
        // Keep the in-memory cart consistent when storage is unavailable.
      }
    },
    [],
  );

  const subtotal = items.reduce(
    (total, item) =>
      total + Math.round(item.price * (1 - (item.discount || 0)) * 100) / 100 * item.quantity,
    0,
  );

  return (
    <CartContext.Provider
      value={{
        items,
        itemCount: items.reduce((total, item) => total + item.quantity, 0),
        subtotal,
        addItem,
        setQuantity,
        removeItem,
        removePurchasedItems,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}
