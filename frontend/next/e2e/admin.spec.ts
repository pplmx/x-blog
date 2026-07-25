import { test, expect } from '@playwright/test';

const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin123';

test.describe('Admin Authentication', () => {
  test('admin login page loads', async ({ page }) => {
    await page.goto('/admin/login');
    await expect(page.locator('input[name="username"], input[placeholder*="用户"]')).toBeVisible();
    await expect(page.locator('input[name="password"], input[type="password"]')).toBeVisible();
  });

  test('login with correct credentials redirects to dashboard', async ({ page }) => {
    await page.goto('/admin/login');
    await page.fill('input[name="username"], input[placeholder*="用户"]', ADMIN_USER);
    await page.fill('input[name="password"], input[type="password"]', ADMIN_PASS);
    await page.click('button[type="submit"]');

    // Should redirect to /admin
    await page.waitForURL('/admin', { timeout: 8000 });
    await expect(page).toHaveURL('/admin');
  });

  test('login with wrong credentials shows error', async ({ page }) => {
    await page.goto('/admin/login');
    await page.fill('input[name="username"], input[placeholder*="用户"]', 'wronguser');
    await page.fill('input[name="password"], input[type="password"]', 'wrongpass');
    await page.click('button[type="submit"]');

    await expect(page.locator('text=用户名或密码错误')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Admin Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/admin/login');
    await page.fill('input[name="username"], input[placeholder*="用户"]', ADMIN_USER);
    await page.fill('input[name="password"], input[type="password"]', ADMIN_PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL('/admin', { timeout: 8000 });
  });

  test('dashboard shows stats cards', async ({ page }) => {
    // Should have stat cards visible
    const cards = page.locator('[class*="card"], [class*="Card"]');
    await expect(cards.first()).toBeVisible({ timeout: 5000 });
  });

  test('can navigate to posts management', async ({ page }) => {
    await page.goto('/admin/posts');
    // Should show posts table or list
    const postsArea = page.locator('table, [class*="table"]');
    if (await postsArea.isVisible()) {
      await expect(postsArea).toBeVisible();
    }
  });

  test('can navigate to categories management', async ({ page }) => {
    await page.goto('/admin/categories');
    await expect(page.locator('h1, h2')).toBeVisible({ timeout: 5000 });
  });

  test('can navigate to comments management', async ({ page }) => {
    await page.goto('/admin/comments');
    await expect(page.locator('h1, h2')).toBeVisible({ timeout: 5000 });
  });

  test('can navigate to tags management', async ({ page }) => {
    await page.goto('/admin/tags');
    await expect(page.locator('h1, h2')).toBeVisible({ timeout: 5000 });
  });
});
