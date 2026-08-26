/**
 * Admin Media Library journey (DEC-183, TASK-207).
 *
 * 1. An author uploads an image in the post editor (real file input) — the
 *    markdown lands in the textarea and the image appears in the media library.
 * 2. Unreferenced uploads show "Unused"; copy-URL writes the /static/uploads/
 *    path; delete removes the card.
 * 3. An image embedded in a post's content shows "In use" with a disabled
 *    delete (409 contract is pinned by tests/test_upload.py).
 */

import { expect, test } from "@playwright/test";

const stamp = Date.now();
// A 1×1 PNG (valid Pillow-decodable image).
const PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function login(page: import("@playwright/test").Page) {
	await page.goto("/admin/login");
	await page.fill('input[type="text"]', "admin");
	await page.fill('input[type="password"]', "admin123");
	await page.click('button[type="submit"]');
	await page.waitForURL("**/admin/posts");
	const token = (await page.evaluate(() => localStorage.getItem("admin_token"))) ?? "";
	return { headers: { Authorization: `Bearer ${token}` } };
}

test.describe("Admin media library (DEC-183)", () => {
	test("upload → library appears → copy + delete unreferenced, delete refused in-use", async ({
		page,
		request,
	}) => {
		const { headers } = await login(page);

		// 1. Upload an image in the real editor: the hidden input wires to
		//    handleImageUpload → insertMarkdown("![image](url)").
		await page.goto("/admin/posts/new");
		const fileInput = page.locator("#image-upload-input");
		await fileInput.setInputFiles({
			name: `media-${stamp}.png`,
			mimeType: "image/png",
			buffer: Buffer.from(PNG_BASE64, "base64"),
		});
		const textarea = page.locator("textarea[placeholder*='编写文章内容']");
		await expect(textarea).toHaveValue(/!\[image\]\(\/static\/uploads\/\d{4}\/\d{2}\/.*\.png\)/, {
			timeout: 10000,
		});
		const content = (await textarea.inputValue()) ?? "";
		const url = content.match(/\]\((\/static\/uploads\/[^)]+\.png)\)/)?.[1];
		expect(url).toBeTruthy();
		const uploadedName = url!.split("/").pop()!;

		// 2. A second upload stays REFERENCED via an API-seeded post, so the
		//    library shows both the in-use badge and the unprotected delete.
		const referenced = await request.post("/api/upload", {
			multipart: {
				file: {
					name: `ref-${stamp}.png`,
					mimeType: "image/png",
					buffer: Buffer.from(PNG_BASE64, "base64"),
				},
			},
			headers,
		});
		expect(referenced.ok()).toBe(true);
		const referencedUrl = ((await referenced.json()) as { url: string }).url;
		const created = await request.post("/api/admin/posts", {
			data: {
				title: `Media ref ${stamp}`,
				slug: `media-ref-${stamp}`,
				content: `embed ![x](${referencedUrl})`,
				excerpt: "seed",
				published: false,
			},
			headers,
		});
		expect(created.ok()).toBe(true);
		const referencedName = referencedUrl.split("/").pop()!;

		// 3. The media library lists both uploads.
		await page.goto("/admin/media");
		await expect(page).toHaveTitle(/媒体|Media/i);
		await expect(page.locator(`text=${uploadedName}`)).toBeVisible();
		await expect(page.locator(`text=${referencedName}`)).toBeVisible();

		// 4. The referenced image card: "In use" badge, delete disabled.
		const referencedCard = page
			.locator(`div:has(> div > img[alt="${referencedName}"])`)
			.first();
		await expect(referencedCard.locator("text=使用中")).toBeVisible();
		await expect(referencedCard.getByRole("button", { name: "删除" })).toBeDisabled();

		// 5. The unreferenced upload: copy-URL reports the /static/... path is
		//    copied, then delete removes the card (img alt is unique per file,
		//    so assert on the image count rather than the filename text which
		//    appears both as the card label and as the img's accessible alt).
		const uploadedCard = page.locator(`div:has(> div > img[alt="${uploadedName}"])`).first();
		await uploadedCard.getByRole("button", { name: /复制链接|Copy/ }).click();
		await expect(uploadedCard.getByRole("button", { name: /已复制|Copied/ })).toBeVisible();

		page.on("dialog", (d) => void d.accept());
		await uploadedCard.getByRole("button", { name: "删除" }).click();
		await expect(page.locator(`img[alt="${uploadedName}"]`)).toHaveCount(0);
		await expect(page.locator(`img[alt="${referencedName}"]`)).toBeVisible();
	});
});
