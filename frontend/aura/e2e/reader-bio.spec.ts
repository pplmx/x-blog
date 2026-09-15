/**
 * Reader profile bio (round 352): the "about me" a reader writes on /account
 * shows up on their public profile page.
 *
 * Registers a reader through the API, signs in through the UI, types a bio in
 * the account profile form, saves, then visits the public /readers/{id} page
 * and asserts the bio (and name) render there. Uses the live backend seeded
 * by the justfile `e2e` task + the Nuxt dev server.
 */

import { expect, test } from "@playwright/test";

const PASSWORD = "readerpass123";

function freshEmail(): string {
	return `bio-${Date.now()}@example.com`;
}

test.describe("Reader profile bio (round 352)", () => {
	test("write a bio in account -> it renders on the public profile", async ({ page, request }) => {
		const email = freshEmail();
		const reg = await request.post("/api/reader/register", {
			data: { email, password: PASSWORD, display_name: "Bio Writer" },
		});
		expect(reg.status()).toBe(201);
		const readerId = ((await reg.json()) as { reader: { id: number } }).reader.id;

		// Sign in through the reader UI (the /login page also hosts a
		// newsletter subscribe form with its own email field — scope to the
		// form that carries the password input).
		await page.goto("/login");
		const loginForm = page.locator('form:has(input[type="password"])');
		await loginForm.locator('input[type="email"]').fill(email);
		await loginForm.locator('input[type="password"]').fill(PASSWORD);
		await loginForm.press("Enter");
		await page.waitForURL("**/bookmarks");

		// Write the bio in the account profile form and save it.
		await page.goto("/account");
		await expect(page.locator("h1", { hasText: "账号设置" })).toBeVisible({ timeout: 10000 });
		const bioBox = page.locator("textarea");
		await expect(bioBox).toBeVisible();
		await bioBox.fill("I run a small self-hosted garden and log the harvest.");
		await page.getByRole("button", { name: "保存" }).click();
		await expect(page.locator("text=已保存")).toBeVisible({ timeout: 5000 });

		// The public profile carries the bio under the display name.
		await page.goto(`/readers/${readerId}`);
		await expect(page.locator("h1")).toContainText("Bio Writer", { timeout: 10000 });
		await expect(page.locator("body")).toContainText(
			"I run a small self-hosted garden and log the harvest.",
			{ timeout: 10000 },
		);
	});
});
