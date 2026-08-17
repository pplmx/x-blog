/**
 * i18n language-switcher end-to-end test (feature: en/zh i18n).
 *
 * Verifies the observable contract of the i18n feature:
 *  1. zh is the default locale (<html lang="zh">, Chinese nav).
 *  2. Clicking the "English" switcher flips the UI to English server-visible
 *     state (<html lang="en">, English nav) immediately.
 *  3. The choice persists across reloads via the `lang` cookie.
 *
 * Nav links appear in the header nav, sidebar quick-links and footer, so the
 * primary nav link locator is scoped to the header <nav>.
 */

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const headerNavLink = (page: Page, name: string) =>
	page.locator("header nav").getByRole("link", { name });

test("defaults to Chinese and shows the Chinese nav", async ({ page }) => {
	await page.goto("/");
	await expect(page.locator("html")).toHaveAttribute("lang", "zh");
	await expect(headerNavLink(page, "首页")).toBeVisible();
});

test("switching to English updates the UI and <html lang>", async ({ page }) => {
	await page.goto("/");
	// The language switcher is a dropdown: open it, then pick English.
	await page.getByRole("button", { name: "中文" }).click();
	await page.getByRole("menuitem", { name: "English" }).click();
	await expect(page.locator("html")).toHaveAttribute("lang", "en");
	await expect(headerNavLink(page, "Home")).toBeVisible();
	await expect(page.getByRole("link", { name: "首页" })).toHaveCount(0);
});

test("the chosen language persists across reloads", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("button", { name: "中文" }).click();
	await page.getByRole("menuitem", { name: "English" }).click();
	await page.reload();
	await expect(page.locator("html")).toHaveAttribute("lang", "en");
	await expect(headerNavLink(page, "Home")).toBeVisible();
});
