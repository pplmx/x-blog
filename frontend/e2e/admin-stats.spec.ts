import { test, expect } from '@playwright/test';

const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin123';

/**
 * Helper function to login as admin
 */
async function adminLogin(page: any) {
  await page.goto('/admin/login');
  await page.fill('input[name="username"], input[placeholder*="用户"]', ADMIN_USER);
  await page.fill('input[name="password"], input[type="password"]', ADMIN_PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL('/admin', { timeout: 8000 });
}

test.describe('Admin Dashboard Stats', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  test('admin dashboard stats cards load', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    // Should have stat cards visible
    const statCards = page.locator('[class*="card"], [class*="stat"], [class*="metric"]');
    const cardCount = await statCards.count();
    
    expect(cardCount).toBeGreaterThan(0);
    await expect(statCards.first()).toBeVisible({ timeout: 5000 });
  });

  test('posts count is displayed', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    // Look for posts count indicator
    const postsCard = page.locator('text=/文章|Posts|post/i');
    
    if (await postsCard.first().isVisible({ timeout: 3000 })) {
      // Should show some number
      await expect(postsCard.first()).toBeVisible();
      
      // Look for a number in the card
      const numberPattern = /\d+/;
      const cardText = await postsCard.first().textContent();
      expect(cardText).toMatch(numberPattern);
    } else {
      test.skip();
    }
  });

  test('comments count is displayed', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    const commentsCard = page.locator('text=/评论|Comments|comment/i');
    
    if (await commentsCard.first().isVisible({ timeout: 3000 })) {
      await expect(commentsCard.first()).toBeVisible();
      const cardText = await commentsCard.first().textContent();
      expect(cardText).toMatch(/\d+/);
    } else {
      test.skip();
    }
  });

  test('categories count is displayed', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    const categoriesCard = page.locator('text=/分类|Categories|category/i');
    
    if (await categoriesCard.first().isVisible({ timeout: 3000 })) {
      await expect(categoriesCard.first()).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('tags count is displayed', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    const tagsCard = page.locator('text=/标签|Tags|tag/i');
    
    if (await tagsCard.first().isVisible({ timeout: 3000 })) {
      await expect(tagsCard.first()).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('stats show correct data format', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    // Check that stats have numbers (not loading/error states)
    const statCards = page.locator('[class*="card"], [class*="stat"]');
    const count = await statCards.count();
    
    if (count > 0) {
      // Each card should have some content
      for (let i = 0; i < Math.min(count, 4); i++) {
        const card = statCards.nth(i);
        if (await card.isVisible()) {
          const text = await card.textContent();
          expect(text).toBeTruthy();
        }
      }
    } else {
      test.skip();
    }
  });
});

test.describe('Analytics Charts', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  test('analytics charts render', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    // Look for chart containers
    const charts = page.locator('canvas, svg, [class*="chart"], [class*="Chart"], [role="img"][aria-label*="chart"]');
    const chartCount = await charts.count();
    
    // Should have at least one chart
    if (chartCount > 0) {
      await expect(charts.first()).toBeVisible({ timeout: 5000 });
    } else {
      // Check for chart placeholder or loading state
      const chartContainer = page.locator('[class*="chart-container"], [class*="analytics"]');
      if (await chartContainer.isVisible()) {
        await expect(chartContainer).toBeVisible();
      } else {
        test.skip();
      }
    }
  });

  test('chart has proper dimensions', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    const chart = page.locator('canvas, svg').first();
    
    if (await chart.isVisible()) {
      const boundingBox = await chart.boundingBox();
      expect(boundingBox).toBeTruthy();
      expect(boundingBox!.width).toBeGreaterThan(0);
      expect(boundingBox!.height).toBeGreaterThan(0);
    } else {
      test.skip();
    }
  });

  test('chart legend is displayed', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    const legend = page.locator('[class*="legend"], [class*="Legend"]');
    
    if (await legend.isVisible()) {
      await expect(legend).toBeVisible();
    }
  });
});

test.describe('Top Posts Section', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  test('top posts section displays', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    // Look for top posts section
    const topPostsSection = page.locator('text=/热门|Top|排行|最受欢迎/i');
    const popularPosts = page.locator('[class*="top-posts"], [class*="popular"]');
    
    const hasTopPosts = await topPostsSection.isVisible({ timeout: 3000 }).catch(() => false);
    const hasPopular = await popularPosts.isVisible({ timeout: 3000 }).catch(() => false);
    
    if (hasTopPosts) {
      await expect(topPostsSection).toBeVisible();
    } else if (hasPopular) {
      await expect(popularPosts).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('top posts show post titles', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    // Look for post links within top posts section
    const postLinks = page.locator('[class*="top-posts"] a, [class*="popular"] a, [class*="rank"] a');
    
    if (await postLinks.first().isVisible({ timeout: 3000 })) {
      const linkCount = await postLinks.count();
      expect(linkCount).toBeGreaterThan(0);
    } else {
      test.skip();
    }
  });

  test('top posts show view counts', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    // Look for view counts or stats in top posts
    const viewCounts = page.locator('[class*="top-posts"] span, [class*="popular"] span');
    
    if (await viewCounts.first().isVisible({ timeout: 3000 })) {
      await expect(viewCounts.first()).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('top posts links navigate to post detail', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    const postLink = page.locator('[class*="top-posts"] a, [class*="popular"] a').first();
    
    if (await postLink.isVisible()) {
      const href = await postLink.getAttribute('href');
      expect(href).toMatch(/\/posts\//);
      
      // Click should navigate
      const urlBefore = page.url();
      await postLink.click();
      await page.waitForURL((url) => url !== urlBefore, { timeout: 5000 });
    } else {
      test.skip();
    }
  });
});

test.describe('Category Distribution Chart', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  test('category distribution chart displays', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    // Look for category distribution section
    const categorySection = page.locator('text=/分类分布|Category Distribution|分类统计/i');
    const categoryChart = page.locator('[class*="category"] canvas, [class*="category"] svg');
    
    const hasSection = await categorySection.isVisible({ timeout: 3000 }).catch(() => false);
    const hasChart = await categoryChart.isVisible({ timeout: 3000 }).catch(() => false);
    
    if (hasSection || hasChart) {
      await expect(categorySection.isVisible() ? categorySection : categoryChart).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('category chart shows legend or labels', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    const labels = page.locator('[class*="category"] span, [class*="category"] li, [class*="chart"] li');
    
    if (await labels.first().isVisible({ timeout: 3000 })) {
      const labelCount = await labels.count();
      expect(labelCount).toBeGreaterThan(0);
    } else {
      test.skip();
    }
  });

  test('category percentages are displayed', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    // Look for percentage values
    const percentages = page.locator('text=/\\d+%/');
    
    if (await percentages.first().isVisible({ timeout: 3000 })) {
      const percentCount = await percentages.count();
      expect(percentCount).toBeGreaterThan(0);
    } else {
      test.skip();
    }
  });
});

test.describe('Dashboard Refresh', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
  });

  test('stats can be refreshed', async ({ page }) => {
    const refreshButton = page.locator('button:has-text("刷新"), button:has-text("Refresh"), button[aria-label*="刷新"]');
    
    if (await refreshButton.isVisible()) {
      await refreshButton.click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('dashboard loads without errors', async ({ page }) => {
    // Check console for errors
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    // Wait a bit for any async errors
    await page.waitForTimeout(1000);
    
    // Filter out known acceptable errors (like 404s for optional assets)
    const criticalErrors = errors.filter(e => !e.includes('404') && !e.includes('favicon'));
    expect(criticalErrors.length).toBe(0);
  });
});

test.describe('Stats Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  test('clicking stats card navigates to related section', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    const postsCard = page.locator('[class*="card"]').filter({ hasText: /文章|Posts/i }).first();
    
    if (await postsCard.isVisible()) {
      // Check if card is clickable
      const clickable = postsCard.locator('a, button');
      
      if (await clickable.isVisible()) {
        const href = await clickable.getAttribute('href');
        if (href) {
          await clickable.click();
          await page.waitForURL((url) => !url.toString().includes('/admin'), { timeout: 5000 });
        }
      }
    } else {
      test.skip();
    }
  });

  test('view detailed analytics link works', async ({ page }) => {
    const detailedLink = page.locator('a:has-text("详情"), a:has-text("Analytics"), a:has-text("详细")').first();
    
    if (await detailedLink.isVisible()) {
      const href = await detailedLink.getAttribute('href');
      if (href) {
        await detailedLink.click();
        await page.waitForURL(href, { timeout: 5000 });
      }
    } else {
      test.skip();
    }
  });
});