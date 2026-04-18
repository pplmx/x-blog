import { test, expect } from '@playwright/test';

test.describe('Internationalization (i18n)', () => {
  test('language switcher is visible in header', async ({ page }) => {
    await page.goto('/');
    const switcher = page.locator('select[aria-label="Switch language"]');
    await expect(switcher).toBeVisible();
  });

  test('can switch to English via language switcher', async ({ page }) => {
    await page.goto('/');
    const switcher = page.locator('select[aria-label="Switch language"]');

    await switcher.selectOption('en');
    await page.waitForURL('/en');

    await expect(page).toHaveURL('/en');
    // English homepage should show "Latest Posts"
    await expect(page.locator('h1')).toContainText(/Latest Posts/i);
  });

  test('English homepage loads directly', async ({ page }) => {
    await page.goto('/en');
    await expect(page).toHaveURL('/en');
    await expect(page.locator('h1')).toContainText(/Latest Posts/i);
  });

  test('English about page loads', async ({ page }) => {
    await page.goto('/en/about');
    await expect(page.locator('h1')).toContainText(/About X-Blog/i);
    await expect(page.getByRole('link', { name: /Back to Home/i })).toBeVisible();
  });

  test('English tags page loads', async ({ page }) => {
    await page.goto('/en/tags');
    await expect(page.locator('h1')).toContainText(/All Tags/i);
  });

  test('switching back to Chinese works', async ({ page }) => {
    await page.goto('/en');
    const switcher = page.locator('select[aria-label="Switch language"]');

    await switcher.selectOption('zh-CN');
    await page.waitForURL(/\/(?!en)/);

    // Should go back to Chinese homepage
    await expect(page.locator('h1')).toContainText(/最新文章/i);
  });

  test('locale is persisted in localStorage', async ({ page }) => {
    await page.goto('/en');
    const stored = await page.evaluate(() => localStorage.getItem('x-blog-locale'));
    expect(stored).toBe('en');
  });
});

test.describe('SEO & Feeds', () => {
  test('RSS feed is accessible', async ({ page }) => {
    const response = await page.goto('/rss.xml');
    expect(response?.status()).toBe(200);
    const content = await page.content();
    expect(content).toContain('<rss');
    expect(content).toContain('<channel>');
  });

  test('Atom feed is accessible', async ({ page }) => {
    const response = await page.goto('/atom.xml');
    expect(response?.status()).toBe(200);
    const content = await page.content();
    expect(content).toContain('<feed');
  });

  test('sitemap.xml is accessible', async ({ page }) => {
    const response = await page.goto('/sitemap.xml');
    expect(response?.status()).toBe(200);
    const content = await page.content();
    expect(content).toContain('<urlset');
    expect(content).toContain('<loc>');
  });

  test('robots.txt is accessible', async ({ page }) => {
    const response = await page.goto('/robots.txt');
    expect(response?.status()).toBe(200);
    const content = await page.content();
    expect(content).toContain('User-agent');
    expect(content).toContain('Sitemap');
  });

  test('opensearch.xml is accessible', async ({ page }) => {
    const response = await page.goto('/opensearch.xml');
    expect(response?.status()).toBe(200);
    const content = await page.content();
    expect(content).toContain('OpenSearchDescription');
  });

  test('RSS autodiscovery link in HTML head', async ({ page }) => {
    await page.goto('/');
    const rssLink = page.locator('link[type="application/rss+xml"]');
    await expect(rssLink).toHaveAttribute('href', '/rss.xml');
  });

  test('Atom autodiscovery link in HTML head', async ({ page }) => {
    await page.goto('/');
    const atomLink = page.locator('link[type="application/atom+xml"]');
    await expect(atomLink).toHaveAttribute('href', '/atom.xml');
  });
});

test.describe('Dark Mode', () => {
  test('dark mode toggle is visible', async ({ page }) => {
    await page.goto('/');
    const toggle = page.locator('button[aria-label*="深色"], button[aria-label*="light"], button[aria-label*="dark"]');
    await expect(toggle).toBeVisible();
  });

  test('can toggle dark mode', async ({ page }) => {
    await page.goto('/');
    const toggle = page.locator('button[aria-label*="深色"], button[aria-label*="light"], button[aria-label*="dark"]').first();

    // Get initial html class
    const initialDark = await page.locator('html').getAttribute('class');

    // Click toggle
    await toggle.click();
    await page.waitForTimeout(300);

    // Class should change
    const afterDark = await page.locator('html').getAttribute('class');
    expect(afterDark).not.toBe(initialDark);
  });

  test('dark mode preference is persisted', async ({ page }) => {
    await page.goto('/');
    const toggle = page.locator('button[aria-label*="深色"], button[aria-label*="light"], button[aria-label*="dark"]').first();

    // Toggle dark mode on
    await toggle.click();
    await page.waitForTimeout(300);

    // Navigate away and back
    await page.goto('/about');
    await page.goto('/');

    // Dark mode should be preserved (html class should contain dark)
    const htmlClass = await page.locator('html').getAttribute('class');
    expect(htmlClass).toMatch(/dark/);
  });
});

test.describe('Tags Page', () => {
  test('tags page shows tag list', async ({ page }) => {
    await page.goto('/tags');
    await expect(page.locator('h1')).toContainText(/所有标签|标签列表|All Tags/i);
  });

  test('clicking a tag shows filtered posts', async ({ page }) => {
    await page.goto('/tags');
    const tagLink = page.locator('a[href*="/tags?tag_id="]').first();

    if (!(await tagLink.isVisible())) {
      test.skip();
      return;
    }

    const href = await tagLink.getAttribute('href');
    await tagLink.click();
    await expect(page).toHaveURL(href!);
    await expect(page.locator('h1')).toBeVisible();
  });
});
