export interface CartItem {
  productId: number;
  name: string;
  imgName?: string | null;
  sku: string;
  unit: string;
  price: number;
  discount: number;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface Cart {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
}

export const MAX_CART_QUANTITY = 99;
