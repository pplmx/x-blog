import { test, expect } from '@playwright/test';

test('homepage loads and shows title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/X-Blog/);
});

test('navigation links work', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: '首页' })).toBeVisible();
});

test('posts are displayed on homepage', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText(/最新文章|筛选结果/);
});

test('search box is visible', async ({ page }) => {
  await page.goto('/');
  const searchInput = page.getByPlaceholder('搜索文章...');
  await expect(searchInput).toBeVisible();
});

test('search functionality works', async ({ page }) => {
  await page.goto('/');
  const searchInput = page.getByPlaceholder('搜索文章...');
  await searchInput.fill('test');
  await searchInput.press('Enter');
  await expect(page).toHaveURL(/q=test/);
});

test('category filter works', async ({ page }) => {
  await page.goto('/');
  const categoryLink = page.locator('aside a').first();
  if (await categoryLink.isVisible()) {
    await categoryLink.click();
    await expect(page.locator('h1')).toContainText('筛选结果');
  }
});

test('post detail page loads', async ({ page }) => {
  await page.goto('/');
  const postLink = page.locator('article a').first();
  if (await postLink.isVisible()) {
    await postLink.click();
    await expect(page.locator('h1')).toBeVisible();
  }
});

test('about page loads', async ({ page }) => {
  await page.goto('/about');
  await expect(page.locator('h1')).toBeVisible();
});

test('admin page loads', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'X-Blog 管理' })).toBeVisible();
});

test('pagination works', async ({ page }) => {
  await page.goto('/');
  const nextButton = page.getByRole('link', { name: '下一页' });
  if (await nextButton.isVisible()) {
    await nextButton.click();
    await expect(page).toHaveURL(/page=2/);
  }
});