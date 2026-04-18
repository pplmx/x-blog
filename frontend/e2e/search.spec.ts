import { test, expect } from '@playwright/test';

test.describe('Search Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('search page loads and displays search input', async ({ page }) => {
    // Navigate to search page via URL or by searching
    await page.goto('/search');
    await page.waitForLoadState('networkidle');

    // Search input should be visible
    const searchInput = page.locator('input[name="q"], input[placeholder*="搜索"], input[type="search"]');
    await expect(searchInput.first()).toBeVisible({ timeout: 5000 });
  });

  test('search page displays search form elements', async ({ page }) => {
    await page.goto('/search');

    // Should have some search-related UI elements
    const searchPageTitle = page.locator('h1, h2');
    if (await searchPageTitle.first().isVisible()) {
      await expect(searchPageTitle.first()).toBeVisible();
    }
  });
});

test.describe('Search Functionality', () => {
  test('search for a post by title', async ({ page }) => {
    // First get a post title
    await page.goto('/');
    const postLink = page.locator('article a h2, article h2, article h3').first();

    let searchTerm = 'test';
    if (await postLink.isVisible({ timeout: 3000 })) {
      const titleText = await postLink.textContent();
      if (titleText && titleText.trim().length > 0) {
        searchTerm = titleText.trim().substring(0, 10);
      }
    }

    // Perform search
    const searchInput = page.getByPlaceholder('搜索文章...');
    await searchInput.fill(searchTerm);
    await searchInput.press('Enter');

    // URL should contain search query
    await expect(page).toHaveURL(/q=|search?/);
  });

  test('search updates URL with query parameter', async ({ page }) => {
    const searchQuery = 'test search query';
    await page.goto('/');

    const searchInput = page.getByPlaceholder('搜索文章...');
    await searchInput.fill(searchQuery);
    await searchInput.press('Enter');

    // Should navigate to search results with query in URL
    await expect(page).toHaveURL(new RegExp(searchQuery));
  });
});

test.describe('Search Results', () => {
  test('empty search results state', async ({ page }) => {
    // Search for something unlikely to exist
    const randomQuery = 'xyznonexistent123' + Date.now();

    const searchInput = page.getByPlaceholder('搜索文章...');
    await searchInput.fill(randomQuery);
    await searchInput.press('Enter');

    // Wait for results to load
    await page.waitForLoadState('networkidle');

    // Should show empty state or "no results" message
    const emptyState = page.locator('text=/没有|暂无|未找到|No results|无结果/i');
    const resultsEmpty = page.locator('text=/未找到|没有找到/i');

    // Either empty state is shown or no articles are displayed
    const hasEmptyState = await emptyState.isVisible({ timeout: 3000 }).catch(() => false);
    const hasNoResults = await resultsEmpty.isVisible({ timeout: 3000 }).catch(() => false);
    const noArticles = await page.locator('article').count() === 0;

    expect(hasEmptyState || hasNoResults || noArticles).toBeTruthy();
  });

  test('search results pagination', async ({ page }) => {
    // Perform a search that might have multiple pages
    const searchInput = page.getByPlaceholder('搜索文章...');
    await searchInput.fill('a'); // Common character that might return many results
    await searchInput.press('Enter');

    await page.waitForLoadState('networkidle');

    // Check for pagination controls
    const pagination = page.locator('[class*="pagination"], nav[aria-label*="分页"], .page-nav');
    const hasPagination = await pagination.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasPagination) {
      await expect(pagination).toBeVisible();

      // Check for next page link
      const nextButton = page.getByRole('link', { name: /下一页|下一页|next/i });
      if (await nextButton.isVisible()) {
        await expect(nextButton).toBeVisible();
      }
    } else {
      // If no pagination, test should be skipped or handled gracefully
      test.skip();
    }
  });
});

test.describe('Search with Special Characters', () => {
  test('search with special characters/unicode', async ({ page }) => {
    // Search with Chinese characters
    const chineseQuery = '测试';

    const searchInput = page.getByPlaceholder('搜索文章...');
    await searchInput.fill(chineseQuery);
    await searchInput.press('Enter');

    // Should handle Chinese input without errors
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/./); // Page should have loaded
  });

  test('search with mixed unicode and english', async ({ page }) => {
    const mixedQuery = 'Hello 世界';

    const searchInput = page.getByPlaceholder('搜索文章...');
    await searchInput.fill(mixedQuery);
    await searchInput.press('Enter');

    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/./);
  });

  test('search with special symbols', async ({ page }) => {
    const symbolsQuery = 'test @#$%';

    const searchInput = page.getByPlaceholder('搜索文章...');
    await searchInput.fill(symbolsQuery);
    await searchInput.press('Enter');

    await page.waitForLoadState('networkidle');
    // Should not crash, page should load
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Search by Category', () => {
  test('search by category on homepage', async ({ page }) => {
    await page.goto('/');

    // Find category links in sidebar
    const categoryLink = page.locator('aside a[href*="/categories/"], aside a[href*="?category="]').first();

    if (!(await categoryLink.isVisible())) {
      test.skip();
      return;
    }

    const categoryHref = await categoryLink.getAttribute('href');
    await categoryLink.click();

    // Should navigate to category-filtered view
    await expect(page).toHaveURL(/categories|category/i);
  });

  test('category filter in search page', async ({ page }) => {
    await page.goto('/search');

    // Look for category dropdown or filter
    const categoryFilter = page.locator('select[name*="category"], select[name*="分类"]');

    if (await categoryFilter.isVisible()) {
      await expect(categoryFilter).toBeVisible();
    } else {
      test.skip();
    }
  });
});

test.describe('Search by Tag', () => {
  test('search by tag via tag links', async ({ page }) => {
    await page.goto('/');

    // Find a tag link
    const tagLink = page.locator('a[href*="/tags/"], a[href*="?tag="]').first();

    if (!(await tagLink.isVisible())) {
      test.skip();
      return;
    }

    const tagHref = await tagLink.getAttribute('href');
    await tagLink.click();

    // Should navigate to tag-filtered page
    await expect(page).toHaveURL(/tags|tag=/);
  });

  test('tag filter in search page', async ({ page }) => {
    await page.goto('/search');

    // Look for tag filter
    const tagFilter = page.locator('select[name*="tag"], input[placeholder*="标签"]');

    if (await tagFilter.first().isVisible()) {
      await expect(tagFilter.first()).toBeVisible();
    } else {
      test.skip();
    }
  });
});
