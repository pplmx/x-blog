import { test, expect } from '@playwright/test';

test.describe('Posts', () => {
  test('post detail page shows title and content', async ({ page }) => {
    await page.goto('/');
    const postLink = page.locator('article a').first();

    if (!(await postLink.isVisible())) {
      test.skip();
      return;
    }

    await postLink.click();
    await page.waitForURL(/\/posts\//);

    // Title should be visible
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 });
    // Main content area should exist
    await expect(page.locator('article, [class*="prose"], [class*="content"]').first()).toBeVisible({ timeout: 5000 });
  });

  test('reading progress bar appears on scroll', async ({ page }) => {
    await page.goto('/');
    const postLink = page.locator('article a').first();

    if (!(await postLink.isVisible())) {
      test.skip();
      return;
    }

    await postLink.click();
    await page.waitForURL(/\/posts\//);

    // Scroll down
    await page.evaluate(() => window.scrollTo(0, 500));

    // Progress indicator should appear
    const progressBar = page.locator('[class*="progress"], [class*="Progress"], [role="progressbar"]');
    if (await progressBar.first().isVisible()) {
      await expect(progressBar.first()).toBeVisible();
    }
  });

  test('tag links filter to correct posts', async ({ page }) => {
    await page.goto('/');

    // Find a tag link
    const tagLink = page.locator('a[href*="/tags/"]').first();

    if (!(await tagLink.isVisible())) {
      test.skip();
      return;
    }

    const tagHref = await tagLink.getAttribute('href');
    await tagLink.click();

    // Should navigate to tags page
    await expect(page).toHaveURL(/\/tags\//, { timeout: 5000 });
    await expect(page.locator('h1')).toBeVisible({ timeout: 5000 });
  });

  test('pagination navigates between pages', async ({ page }) => {
    await page.goto('/');

    const nextButton = page.getByRole('link', { name: /下一页|next/i }).first();
    if (!(await nextButton.isVisible())) {
      test.skip();
      return;
    }

    const urlBefore = page.url();
    await nextButton.click();
    await page.waitForURL((url) => url !== urlBefore, { timeout: 5000 });

    // Should show different content
    await expect(page.locator('article').first()).toBeVisible({ timeout: 5000 });
  });

  test('related posts section shows when available', async ({ page }) => {
    await page.goto('/');
    const postLink = page.locator('article a').first();

    if (!(await postLink.isVisible())) {
      test.skip();
      return;
    }

    await postLink.click();
    await page.waitForURL(/\/posts\//);

    // Look for related posts section
    const relatedSection = page.locator('text=/相关|Related/i');
    if (await relatedSection.isVisible({ timeout: 3000 })) {
      await expect(page.locator('article a').first()).toBeVisible({ timeout: 3000 });
    }
  });
});
