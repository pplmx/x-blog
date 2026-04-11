import { test, expect } from '@playwright/test';

test('homepage loads and shows title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/X-Blog/);
});

test('navigation links work', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: '首页' })).toBeVisible();
});
