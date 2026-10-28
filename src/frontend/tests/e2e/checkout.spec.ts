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
  await page.getByRole('button', { name: 'Review total and prepare payment' }).click();
  await expect(page.getByRole('alert')).toContainText('your cart is unchanged');
  await page.getByRole('link', { name: 'Back to cart' }).click();
  await expect(page.getByText('Checkout Feeder')).toBeVisible();
  await expect(page.getByLabel('Quantity')).toHaveValue('1');
});

test('paid checkout preserves cart changes from another tab and is idempotent on refresh', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem(
      'octocat-cart',
      JSON.stringify([
        {
          productId: 1,
          name: 'Checkout Feeder',
          description: 'A feeder for checkout testing',
          price: 25,
          imgName: 'feeder.png',
          quantity: 2,
        },
      ]),
    );
  });
  let releaseStatus!: () => void;
  const statusRequest = new Promise<void>((resolve) => {
    releaseStatus = resolve;
  });
  await page.route('**/api/checkout/sessions/cs_test_paid', async (route) => {
    await statusRequest;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'paid',
        orderId: 12,
        items: [{ productId: 1, quantity: 1 }],
      }),
    });
  });

  await page.goto('/checkout/success?session_id=cs_test_paid');
  const otherTab = await page.context().newPage();
  await otherTab.goto('/cart');
  await expect(otherTab.getByLabel('Quantity')).toHaveValue('2');
  await otherTab.evaluate(() => {
    const cart = JSON.parse(localStorage.getItem('octocat-cart') || '[]');
    cart[0].quantity = 3;
    localStorage.setItem('octocat-cart', JSON.stringify(cart));
  });
  await expect(page.getByRole('link', { name: 'Cart (3)' })).toBeVisible();
  releaseStatus();
  await expect(page.getByRole('status')).toContainText('Payment confirmed');
  await expect(page.getByRole('status')).toContainText('12');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('octocat-cart')))
    .toContain('"quantity":2');
  await page.goto('/checkout/success?session_id=cs_test_paid');
  await expect(page.getByRole('status')).toContainText('Payment confirmed');
  await page.getByRole('link', { name: /Cart/ }).first().click();
  await expect(page.getByLabel('Quantity')).toHaveValue('2');
  await otherTab.close();
});
