import axios from 'axios';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { api } from '../api/config';
import type { Cart } from '../types/cart';

const CART_KEY = 'cart';
const cartUrl = `${api.baseURL}${api.endpoints.cart}`;

export function useCart() {
  const queryClient = useQueryClient();
  const query = useQuery<Cart>(CART_KEY, async () => (await axios.get<Cart>(cartUrl)).data);

  // Every mutation returns the server-computed cart, which becomes the cache.
  const onSuccess = (cart: Cart) => {
    queryClient.setQueryData(CART_KEY, cart);
  };

  const addItem = useMutation(
    async (vars: { productId: number; quantity: number }) =>
      (await axios.post<Cart>(`${cartUrl}/items`, vars)).data,
    { onSuccess },
  );
  const updateItem = useMutation(
    async (vars: { productId: number; quantity: number }) =>
      (await axios.put<Cart>(`${cartUrl}/items/${vars.productId}`, { quantity: vars.quantity })).data,
    { onSuccess },
  );
  const removeItem = useMutation(
    async (productId: number) => (await axios.delete<Cart>(`${cartUrl}/items/${productId}`)).data,
    { onSuccess },
  );

  return { ...query, addItem, updateItem, removeItem };
}
