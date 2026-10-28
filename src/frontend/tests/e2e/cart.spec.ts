import { test, expect } from '@playwright/test';

/**
 * Cart E2E tests (requires the API to be running; the cart is a single shared demo cart).
 * Covers add, update quantity, remove, and server-computed totals.
 */

test.describe('Cart', () => {
  test.beforeEach(async ({ page, request }) => {
    const apiURL =
      process.env.PLAYWRIGHT_API_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5137';
    await request.delete(`${apiURL}/api/cart`);
    await page.goto('/products');
    await expect(page.locator('h3').first()).toBeVisible();
  });

  test('Add, update quantity, and remove an item with accurate totals', async ({ page }) => {
    // Add 2 of the first product
    await page.locator('[id^="increase-qty-"]').first().click();
    await page.locator('[id^="increase-qty-"]').first().click();
    await page.locator('[id^="add-to-cart-"]').first().click();
    await expect(page.getByText('Added to cart.')).toBeVisible();
    await expect(page.getByTestId('cart-count')).toHaveText('2');

    await page.click('nav a:has-text("Cart")');
    await expect(page).toHaveURL(/\/cart/);
    const item = page.locator('[data-testid^="cart-item-"]').first();
    await expect(item).toBeVisible();

    const parse = (s: string | null) => Number((s ?? '').replace(/[^0-9.]/g, ''));
    const lineTotal = async () => parse(await item.getByTestId('line-total').textContent());
    const subtotal = async () => parse(await page.getByTestId('cart-subtotal').textContent());

    const twoQty = await lineTotal();
    expect(await subtotal()).toBeCloseTo(twoQty, 2);

    // Increase to 3: the line total scales and the subtotal follows
    await item.getByRole('button', { name: /Increase quantity/ }).click();
    await expect(item.getByLabel(/^Quantity of/)).toHaveText('3');
    await expect.poll(lineTotal).toBeGreaterThan(twoQty);
    expect(await subtotal()).toBeCloseTo(await lineTotal(), 2);

    // The change persists across a reload
    await page.reload();
    await expect(page.locator('[data-testid^="cart-item-"]').first().getByLabel(/^Quantity of/)).toHaveText('3');

    // Remove it
    await page.getByRole('button', { name: /^Remove .* from cart$/ }).click();
    await expect(page.getByTestId('cart-empty')).toBeVisible();
  });
});
