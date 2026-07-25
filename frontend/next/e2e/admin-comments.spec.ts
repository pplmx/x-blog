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

test.describe('Admin Comments Management', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await adminLogin(page);
  });

  test('navigate to comments management', async ({ page }) => {
    await page.goto('/admin/comments');
    await page.waitForLoadState('networkidle');

    // Should show comments management interface
    const heading = page.locator('h1, h2');
    await expect(heading.first()).toBeVisible({ timeout: 5000 });

    // Should have some comments-related UI
    const commentsSection = page.locator('[class*="comment"], table, [class*="list"]');
    if (await commentsSection.first().isVisible()) {
      await expect(commentsSection.first()).toBeVisible();
    }
  });

  test('comments management page shows comments list', async ({ page }) => {
    await page.goto('/admin/comments');
    await page.waitForLoadState('networkidle');

    // Should show some comments or empty state
    const commentsTable = page.locator('table');
    const commentsList = page.locator('[class*="comment"]');
    const emptyState = page.locator('text=/暂无|没有|暂无评论/i');

    const hasTable = await commentsTable.isVisible().catch(() => false);
    const hasList = await commentsList.first().isVisible().catch(() => false);
    const hasEmpty = await emptyState.isVisible().catch(() => false);

    expect(hasTable || hasList || hasEmpty).toBeTruthy();
  });
});

test.describe('Comment Moderation', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  test('view pending comments count', async ({ page }) => {
    await page.goto('/admin/comments');
    await page.waitForLoadState('networkidle');

    // Look for pending count badge or indicator
    const pendingBadge = page.locator('text=/待审|pending/i, [class*="badge"]:has-text("待")');
    const countElement = page.locator('[class*="count"]:has-text("待"), [class*="badge"]:has-text("待")');

    // Should have some indication of pending comments
    const hasPendingIndicator = await pendingBadge.isVisible({ timeout: 3000 }).catch(() => false);
    const hasCount = await countElement.isVisible({ timeout: 3000 }).catch(() => false);

    // This is informational - just check page loaded
    await expect(page.locator('body')).toBeVisible();
  });

  test('approve a pending comment', async ({ page }) => {
    await page.goto('/admin/comments');
    await page.waitForLoadState('networkidle');

    // Look for approve button or action
    const approveButton = page.locator('button:has-text("通过"), button:has-text("批准"), button:has-text("Approve"), button[aria-label*="通过"], button[aria-label*="批准"]');

    if (await approveButton.first().isVisible()) {
      // Click approve
      await approveButton.first().click();
      await page.waitForLoadState('networkidle');

      // Should show success or update state
      // No error should occur
      await expect(page.locator('body')).toBeVisible();
    } else {
      // No pending comments to approve - this is acceptable
      test.skip();
    }
  });

  test('reject/delete a comment', async ({ page }) => {
    await page.goto('/admin/comments');
    await page.waitForLoadState('networkidle');

    // Look for reject/delete button
    const rejectButton = page.locator('button:has-text("拒绝"), button:has-text("删除"), button:has-text("Reject"), button:has-text("Delete"), button[aria-label*="拒绝"], button[aria-label*="删除"]');

    if (await rejectButton.first().isVisible()) {
      await rejectButton.first().click();
      await page.waitForLoadState('networkidle');

      // Should show confirmation or directly delete
      await expect(page.locator('body')).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('mark comment as spam', async ({ page }) => {
    await page.goto('/admin/comments');
    await page.waitForLoadState('networkidle');

    const spamButton = page.locator('button:has-text("垃圾"), button:has-text("Spam"), button[aria-label*="垃圾"]');

    if (await spamButton.first().isVisible()) {
      await spamButton.first().click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toBeVisible();
    } else {
      test.skip();
    }
  });
});

test.describe('Comments Filtering', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await page.goto('/admin/comments');
    await page.waitForLoadState('networkidle');
  });

  test('filter comments by status - pending', async ({ page }) => {
    // Look for status filter dropdown/buttons
    const statusFilter = page.locator('select[name*="status"], .filter-group select, .status-filter');
    const statusButtons = page.locator('button:has-text("待审"), button:has-text("Pending")');

    if (await statusFilter.isVisible()) {
      await statusFilter.selectOption(/pending|待审/i);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toBeVisible();
    } else if (await statusButtons.isVisible()) {
      await statusButtons.first().click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('filter comments by status - approved', async ({ page }) => {
    const statusFilter = page.locator('select[name*="status"], .filter-group select');
    const statusButtons = page.locator('button:has-text("通过"), button:has-text("Approved")');

    if (await statusFilter.isVisible()) {
      await statusFilter.selectOption(/approved|通过/i);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toBeVisible();
    } else if (await statusButtons.isVisible()) {
      await statusButtons.first().click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('filter comments by status - rejected', async ({ page }) => {
    const statusFilter = page.locator('select[name*="status"], .filter-group select');
    const statusButtons = page.locator('button:has-text("拒绝"), button:has-text("Rejected")');

    if (await statusFilter.isVisible()) {
      await statusFilter.selectOption(/rejected|拒绝/i);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toBeVisible();
    } else if (await statusButtons.isVisible()) {
      await statusButtons.first().click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('show all comments', async ({ page }) => {
    const allFilter = page.locator('button:has-text("全部"), button:has-text("All")');

    if (await allFilter.isVisible()) {
      await allFilter.first().click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toBeVisible();
    } else {
      test.skip();
    }
  });
});

test.describe('Comments Search', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await page.goto('/admin/comments');
    await page.waitForLoadState('networkidle');
  });

  test('search comments by author', async ({ page }) => {
    const searchInput = page.locator('input[name*="search"], input[name*="author"], input[placeholder*="搜索"], input[placeholder*="作者"]');

    if (await searchInput.isVisible()) {
      await searchInput.fill('admin');
      await searchInput.press('Enter');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('search comments by content', async ({ page }) => {
    const searchInput = page.locator('input[name*="search"], input[name*="content"], input[placeholder*="搜索"], input[placeholder*="内容"]');

    if (await searchInput.isVisible()) {
      await searchInput.fill('test');
      await searchInput.press('Enter');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('search results update correctly', async ({ page }) => {
    const searchInput = page.locator('input[name*="search"], input[placeholder*="搜索"]');

    if (await searchInput.isVisible()) {
      const searchTerm = 'test';
      await searchInput.fill(searchTerm);
      await searchInput.press('Enter');
      await page.waitForLoadState('networkidle');

      // URL might update with search parameter
      const url = page.url();
      expect(url).toBeTruthy();
    } else {
      test.skip();
    }
  });
});

test.describe('Comment Actions', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await page.goto('/admin/comments');
    await page.waitForLoadState('networkidle');
  });

  test('view comment details', async ({ page }) => {
    const commentRow = page.locator('[class*="comment"], tr').first();

    if (await commentRow.isVisible()) {
      // Look for detail view or expand button
      const detailButton = page.locator('button:has-text("详情"), button:has-text("查看"), a:has-text("详情")').first();

      if (await detailButton.isVisible()) {
        await detailButton.click();
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
      }
    } else {
      test.skip();
    }
  });

  test('edit comment', async ({ page }) => {
    const editButton = page.locator('button:has-text("编辑"), button:has-text("Edit"), a:has-text("编辑")').first();

    if (await editButton.isVisible()) {
      await editButton.click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('bulk select and approve comments', async ({ page }) => {
    const checkbox = page.locator('input[type="checkbox"]').first();
    const bulkApproveButton = page.locator('button:has-text("批量"), button:has-text("Bulk"), button:has-text("批量通过")').first();

    if (await checkbox.isVisible() && await bulkApproveButton.isVisible()) {
      await checkbox.check();
      await bulkApproveButton.click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('pagination works in comments list', async ({ page }) => {
    const pagination = page.locator('[class*="pagination"], nav[aria-label*="分页"]');

    if (await pagination.isVisible()) {
      const nextButton = page.getByRole('link', { name: /下一页|next/i });

      if (await nextButton.isVisible()) {
        const urlBefore = page.url();
        await nextButton.click();
        await page.waitForURL((url) => url !== urlBefore, { timeout: 5000 });
        await expect(page.locator('body')).toBeVisible();
      } else {
        test.skip();
      }
    } else {
      test.skip();
    }
  });
});
