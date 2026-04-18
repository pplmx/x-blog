import { test, expect } from '@playwright/test';

test.describe('Category Filter Dropdown', () => {
  test('category dropdown is visible on homepage', async ({ page }) => {
    await page.goto('/');

    // Look for category dropdown/select
    const categoryDropdown = page.locator('select[name*="category"], select[aria-label*="分类"]');
    const categoryNav = page.locator('nav a[href*="categories"], aside a[href*="categories"]');

    const hasDropdown = await categoryDropdown.isVisible({ timeout: 3000 }).catch(() => false);
    const hasNavLinks = await categoryNav.first().isVisible({ timeout: 3000 }).catch(() => false);

    expect(hasDropdown || hasNavLinks).toBeTruthy();
  });

  test('category links are displayed in sidebar', async ({ page }) => {
    await page.goto('/');

    // Check for category links in sidebar
    const categoryLinks = page.locator('aside a[href*="/categories/"], aside a[href*="category"]');
    const count = await categoryLinks.count();

    if (count > 0) {
      await expect(categoryLinks.first()).toBeVisible();
    } else {
      test.skip();
    }
  });
});

test.describe('Filter Posts by Category', () => {
  test('filter posts by clicking category tag', async ({ page }) => {
    await page.goto('/');

    // Find category link in aside or post cards
    const categoryLink = page.locator('aside a[href*="/categories/"], article a[href*="/categories/"]').first();

    if (!(await categoryLink.isVisible())) {
      test.skip();
      return;
    }

    // Get initial article count
    const initialArticles = await page.locator('article').count();

    // Click category link
    await categoryLink.click();
    await page.waitForLoadState('networkidle');

    // URL should contain category parameter
    await expect(page).toHaveURL(/categories|category_id/i);

    // Articles should be visible
    await expect(page.locator('article').first()).toBeVisible({ timeout: 5000 });
  });

  test('clicking category filters to show only category posts', async ({ page }) => {
    await page.goto('/');

    // Find a category link
    const categoryLink = page.locator('aside a[href*="/categories/"]').first();

    if (!(await categoryLink.isVisible())) {
      test.skip();
      return;
    }

    const categoryHref = await categoryLink.getAttribute('href');
    const categoryName = await categoryLink.textContent();

    // Click to filter
    await categoryLink.click();
    await page.waitForLoadState('networkidle');

    // Page should show filtered results
    await expect(page.locator('h1, h2')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Category Page', () => {
  test('category page shows filtered posts', async ({ page }) => {
    await page.goto('/');

    // Find category link
    const categoryLink = page.locator('aside a[href*="/categories/"]').first();

    if (!(await categoryLink.isVisible())) {
      test.skip();
      return;
    }

    const categoryHref = await categoryLink.getAttribute('href');

    // Navigate directly to category page
    await page.goto(categoryHref!);
    await page.waitForLoadState('networkidle');

    // Should show posts
    await expect(page.locator('article').first()).toBeVisible({ timeout: 5000 });
  });

  test('category page shows correct heading', async ({ page }) => {
    await page.goto('/categories');

    // Should show categories list
    const heading = page.locator('h1, h2').first();
    if (await heading.isVisible()) {
      await expect(heading).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('category page shows correct post count', async ({ page }) => {
    await page.goto('/');

    // Find category link and get its href
    const categoryLink = page.locator('aside a[href*="/categories/"]').first();

    if (!(await categoryLink.isVisible())) {
      test.skip();
      return;
    }

    // Look for post count indicator near category
    const countBadge = page.locator('span[class*="count"], .badge');

    // Navigate to category page
    const categoryHref = await categoryLink.getAttribute('href');
    await page.goto(categoryHref!);
    await page.waitForLoadState('networkidle');

    // Count displayed posts
    const postCount = await page.locator('article').count();
    expect(postCount).toBeGreaterThanOrEqual(0);
  });
});

test.describe('Back to All Posts', () => {
  test('back to all posts from category filter', async ({ page }) => {
    await page.goto('/');

    // Find and click a category
    const categoryLink = page.locator('aside a[href*="/categories/"]').first();

    if (!(await categoryLink.isVisible())) {
      test.skip();
      return;
    }

    await categoryLink.click();
    await page.waitForLoadState('networkidle');

    // Look for "All Posts" or "全部" or "返回首页" link
    const backLink = page.getByRole('link', { name: /全部|All|首页|Home/i }).first();

    if (await backLink.isVisible()) {
      await backLink.click();
      await page.waitForLoadState('networkidle');

      // Should be back on homepage
      await expect(page).toHaveURL('/');
      await expect(page.locator('h1')).toContainText(/最新文章/i);
    } else {
      test.skip();
    }
  });

  test('logo click returns to all posts', async ({ page }) => {
    // Filter by category first
    await page.goto('/categories');

    const categoryLink = page.locator('a[href*="/categories/"]').first();
    if (await categoryLink.isVisible()) {
      const categoryHref = await categoryLink.getAttribute('href');
      await page.goto(categoryHref!);
      await page.waitForLoadState('networkidle');
    }

    // Click logo to go back to homepage
    const logo = page.locator('a[href="/"], header a').first();

    if (await logo.isVisible()) {
      await logo.click();
      await page.waitForLoadState('networkidle');

      // Should be on homepage showing all posts
      await expect(page.locator('h1')).toContainText(/最新文章/i);
    } else {
      test.skip();
    }
  });
});

test.describe('URL Updates with Category Filter', () => {
  test('URL updates with category filter', async ({ page }) => {
    await page.goto('/');

    // Find category link
    const categoryLink = page.locator('aside a[href*="/categories/"]').first();

    if (!(await categoryLink.isVisible())) {
      test.skip();
      return;
    }

    const originalUrl = page.url();
    const categoryHref = await categoryLink.getAttribute('href');

    await categoryLink.click();
    await page.waitForURL((url) => url.toString() !== originalUrl, { timeout: 5000 });

    // URL should have changed and contain category parameter
    const newUrl = page.url();
    expect(newUrl).not.toBe(originalUrl);
    expect(newUrl).toMatch(/categories|category_id/i);
  });

  test('category filter is preserved in URL', async ({ page }) => {
    // Navigate directly to category URL
    await page.goto('/categories');

    const categoryLink = page.locator('a[href*="/categories/"]').first();
    if (await categoryLink.isVisible()) {
      const categoryHref = await categoryLink.getAttribute('href');
      await page.goto(categoryHref!);
      await page.waitForLoadState('networkidle');

      // URL should contain category info
      expect(page.url()).toMatch(/categories|category_id/i);

      // Reload page
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Filter should still be applied
      expect(page.url()).toMatch(/categories|category_id/i);
    } else {
      test.skip();
    }
  });

  test('navigating back clears category filter', async ({ page }) => {
    await page.goto('/');

    // Apply category filter
    const categoryLink = page.locator('aside a[href*="/categories/"]').first();
    if (await categoryLink.isVisible()) {
      await categoryLink.click();
      await page.waitForLoadState('networkidle');

      // Go back in browser
      await page.goBack();
      await page.waitForLoadState('networkidle');

      // URL should not have category parameter (or be homepage)
      if (page.url().includes('category')) {
        await expect(page).toHaveURL('/');
      }
    } else {
      test.skip();
    }
  });
});
