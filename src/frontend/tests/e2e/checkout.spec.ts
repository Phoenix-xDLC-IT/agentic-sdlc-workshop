import { test, expect } from '@playwright/test';

test('payment failure shows an error and leaves cart contents intact', async ({ page }) => {
  await page.route('**/api/products', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          productId: 1,
          name: 'Checkout Feeder',
          description: 'A feeder for checkout testing',
          price: 25,
          imgName: 'feeder.png',
          sku: 'TEST-1',
          unit: 'each',
          supplierId: 1,
        },
      ]),
    }),
  );
  await page.route('**/api/checkout/sessions', (route) =>
    route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'PAYMENT_PROVIDER_ERROR' } }),
    }),
  );

  await page.goto('/products');
  await expect(page.getByRole('heading', { name: 'Checkout Feeder' })).toBeVisible();
  await page.locator('#increase-qty-1').click();
  await page.locator('#add-to-cart-1').click();
  await page.getByRole('link', { name: /Cart/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Your Cart' })).toBeVisible();
  await expect(page.getByText('Checkout Feeder')).toBeVisible();

  await page.getByRole('link', { name: 'Continue to checkout' }).click();
  await page.getByRole('button', { name: 'Pay securely' }).click();
  await expect(page.getByRole('alert')).toContainText('your cart is unchanged');
  await page.getByRole('link', { name: 'Back to cart' }).click();
  await expect(page.getByText('Checkout Feeder')).toBeVisible();
  await expect(page.getByLabel('Quantity')).toHaveValue('1');
});
