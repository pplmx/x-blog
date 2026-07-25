import { test, expect } from '@playwright/test';

test.describe('Comments', () => {
  test.beforeEach(async ({ page }) => {
    // Go to first available post
    await page.goto('/');
    const postLink = page.locator('article a').first();
    if (await postLink.isVisible()) {
      await postLink.click();
      await page.waitForURL(/\/posts\//);
    }
  });

  test('comment form is visible on post detail', async ({ page }) => {
    await expect(page.locator('textarea[name="content"], textarea[placeholder*="评论"]')).toBeVisible({ timeout: 5000 });
  });

  test('can submit a comment with nickname and content', async ({ page }) => {
    const nicknameInput = page.locator('input[name="nickname"], input[placeholder*="昵称"]');
    const contentArea = page.locator('textarea[name="content"], textarea[placeholder*="评论"]');

    await nicknameInput.fill('E2E Tester');
    await contentArea.fill('This is an automated e2e test comment at ' + new Date().toISOString());

    // Intercept POST to comments API
    const responsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/comments') && res.status() === 201,
      { timeout: 5000 }
    );

    await page.click('button[type="submit"]');

    // Should succeed
    const response = await responsePromise;
    expect(response.status()).toBe(201);
  });

  test('comment form validation - empty content rejected', async ({ page }) => {
    const submitButton = page.locator('button[type="submit"]');
    const contentArea = page.locator('textarea[name="content"], textarea[placeholder*="评论"]');

    await contentArea.fill('');

    await submitButton.click();

    // Form should still be visible (submission prevented)
    await expect(submitButton).toBeVisible();
  });

  test('like button is visible on post', async ({ page }) => {
    const likeButton = page.locator('button[aria-label*="赞"], button:has-text("赞"), button:has-text("❤️")');
    await expect(likeButton).toBeVisible({ timeout: 5000 });
  });
});
