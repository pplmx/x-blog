/**
 * Admin Media Library page tests (DEC-183, TASK-207).
 *
 * Renders the uploaded-image grid from the media API, marks referenced images
 * (delete disabled), copies a URL, and deletes an unreferenced image with
 * client refresh on success / error surfaced on failure.
 */

import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetchResult, mountWithSuspense, stubNuxtGlobals } from "../admin/helpers";

vi.stubGlobal("definePageMeta", vi.fn());

const listMock = vi.fn();
const deleteMock = vi.fn();
const batchDeleteMock = vi.fn();

vi.mock("../../api/admin/media", () => ({
	// useAdminMedia returns an AsyncData-like object the page destructures as
	// { data, pending, error, refresh }.
	useAdminMedia: (page: number, pageSize: number) => listMock(page, pageSize),
	deleteAdminMediaFile: deleteMock,
	batchDeleteAdminMediaFiles: batchDeleteMock,
}));

stubNuxtGlobals();

const referenced = {
	url: "/static/uploads/2026/07/11111111-2222-4444-8888-000000000001.png",
	year: 2026,
	month: 7,
	filename: "11111111-2222-4444-8888-000000000001.png",
	size: 2048,
	width: 1200,
	height: 800,
	uploaded_at: "2026-07-15T10:00:00Z",
	referenced: true,
	referencing_posts: [{ id: 1, title: "In use" }],
};
const unreferenced = {
	url: "/static/uploads/2026/07/11111111-2222-4444-8888-000000000002.png",
	year: 2026,
	month: 7,
	filename: "11111111-2222-4444-8888-000000000002.png",
	size: 512,
	width: 600,
	height: 300,
	uploaded_at: "2026-07-16T10:00:00Z",
	referenced: false,
	referencing_posts: [],
};

function fakeListing(items: unknown[], refreshImpl?: () => Promise<void>) {
	const state = mockFetchResult({
		items,
		pagination: { total: items.length, page: 1, limit: 60, total_pages: 1 },
	});
	return { ...state, refresh: refreshImpl ?? state.refresh };
}

let MediaPage: unknown;
async function mountPage() {
	MediaPage = MediaPage ?? (await import("../../app/pages/admin/media.vue")).default;
	return mountWithSuspense(MediaPage as never);
}

describe("Admin Media page", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.clearAllMocks();
		vi.stubGlobal("definePageMeta", vi.fn());
		stubNuxtGlobals();
	});

	it("renders each uploaded image from the listing", async () => {
		listMock.mockReturnValue(fakeListing([referenced, unreferenced]));
		const wrapper = await mountPage();
		const imgs = wrapper.findAll("img");
		expect(imgs.length).toBe(2);
		expect(wrapper.text()).toContain(referenced.filename);
		expect(wrapper.text()).toContain(unreferenced.filename);
	});

	it("disables delete for referenced images with an in-use label", async () => {
		listMock.mockReturnValue(fakeListing([referenced]));
		const wrapper = await mountPage();
		const deleteBtn = wrapper.findAll("button").find((b) => b.text().trim() === "删除");
		if (!deleteBtn) throw new Error("expected a 删除 button");
		expect(deleteBtn.attributes("disabled")).toBeDefined();
		expect(wrapper.text()).toContain("使用中");
	});

	it("deletes an unreferenced image and refreshes the list", async () => {
		const refresh = vi.fn(() => Promise.resolve());
		listMock.mockReturnValue(fakeListing([unreferenced], refresh));
		deleteMock.mockResolvedValue({ message: "Media deleted" });
		const originalConfirm = window.confirm;
		window.confirm = vi.fn(() => true);

		try {
			const wrapper = await mountPage();
			const deleteBtn = wrapper.findAll("button").find((b) => b.text().trim() === "删除");
			if (!deleteBtn) throw new Error("expected a 删除 button");
			expect(deleteBtn.attributes("disabled")).toBeUndefined();
			await deleteBtn.trigger("click");
			await flushPromises();

			expect(deleteMock).toHaveBeenCalledWith(unreferenced);
			expect(refresh).toHaveBeenCalled();
		} finally {
			window.confirm = originalConfirm;
		}
	});

	it("drops a single-deleted image from the bulk selection (round 259 review)", async () => {
		// A card that was ticked for the bulk selection and then single-deleted
		// must leave the selection — otherwise "已选 N 张" counts a deleted file
		// and 删除选中 operates on a phantom URL (backend skips it idempotently,
		// so no error, but the count/button are wrong). Round-259 review finding.
		const refresh = vi.fn(() => Promise.resolve());
		listMock.mockReturnValue(
			fakeListing(
				[
					{ ...unreferenced },
					{
						...unreferenced,
						url: "/static/uploads/2026/07/11111111-2222-4444-8888-000000000003.png",
					},
				],
				refresh,
			),
		);
		deleteMock.mockResolvedValue({ message: "ok" });
		const originalConfirm = window.confirm;
		window.confirm = vi.fn(() => true);

		try {
			const wrapper = await mountPage();
			const select = wrapper.find('button[aria-label="选择"]');
			await select.trigger("click"); // tick row 1
			expect(wrapper.text()).toContain("已选 1 张");

			const deleteBtn = wrapper.findAll("button").find((b) => b.text().trim() === "删除");
			await deleteBtn?.trigger("click"); // single-delete the SAME card
			await flushPromises();

			// The deleted card left the selection — no phantom count or batch button.
			expect(wrapper.text()).not.toContain("已选 1 张");
			expect(wrapper.findAll("button").find((b) => b.text().trim() === "删除选中")).toBeUndefined();
		} finally {
			window.confirm = originalConfirm;
		}
	});

	it("keeps other rows deletable while one delete is in flight (per-row markers, round 259)", async () => {
		// A global `isDeleting` flag froze the whole grid on the first click. The
		// per-row marker keeps other rows clickable — which also makes the busy
		// state genuinely observable, since happy-dom swallows clicks on disabled
		// buttons — and row 1's marker survives row 2's completion (no cross-row
		// clobber, the same property the readers/account fixes enforce).
		const refresh = vi.fn(() => Promise.resolve());
		listMock.mockReturnValue(
			fakeListing(
				[
					{ ...unreferenced },
					{
						...unreferenced,
						url: "/static/uploads/2026/07/11111111-2222-4444-8888-000000000003.png",
					},
				],
				refresh,
			),
		);
		let resolveDelete!: (v: unknown) => void;
		deleteMock
			.mockImplementationOnce(
				() =>
					new Promise((res) => {
						resolveDelete = res;
					}),
			)
			.mockResolvedValue({ message: "ok" });
		const originalConfirm = window.confirm;
		window.confirm = vi.fn(() => true);

		try {
			const wrapper = await mountPage();
			const deleteBtns = () => wrapper.findAll("button").filter((b) => b.text().trim() === "删除");
			await deleteBtns()[0].trigger("click"); // row 1 — in flight
			await flushPromises();
			expect((deleteBtns()[0].element as HTMLButtonElement).disabled).toBe(true);
			// Row 2 was NOT frozen out — the old global flag disabled it here.
			expect((deleteBtns()[1].element as HTMLButtonElement).disabled).toBe(false);

			// Row 2's delete RUNS AND COMPLETES while row 1 is still pending.
			await deleteBtns()[1].trigger("click");
			await flushPromises();
			expect(deleteMock).toHaveBeenCalledTimes(2);
			// Row 1's marker was NOT cleared by row 2's completion.
			expect((deleteBtns()[0].element as HTMLButtonElement).disabled).toBe(true);

			resolveDelete({ message: "ok" });
			await flushPromises();
			expect((deleteBtns()[0].element as HTMLButtonElement).disabled).toBe(false);
			expect(refresh).toHaveBeenCalled();
		} finally {
			window.confirm = originalConfirm;
		}
	});

	it("blocks a batch delete while a single-row delete is in flight (round 259)", async () => {
		// A batch delete and an in-flight single delete must not run
		// concurrently (their refreshes interleave; a file in both would
		// double-delete → 404 on the second). The batch guard must drop the
		// click while the single delete holds the bus.
		const refresh = vi.fn(() => Promise.resolve());
		listMock.mockReturnValue(
			fakeListing(
				[
					{ ...unreferenced },
					{
						...unreferenced,
						url: "/static/uploads/2026/07/11111111-2222-4444-8888-000000000003.png",
					},
				],
				refresh,
			),
		);
		let resolveDelete!: (v: unknown) => void;
		deleteMock.mockImplementationOnce(
			() =>
				new Promise((res) => {
					resolveDelete = res;
				}),
		);
		const originalConfirm = window.confirm;
		window.confirm = vi.fn(() => true);

		try {
			const wrapper = await mountPage();
			const deleteBtns = () => wrapper.findAll("button").filter((b) => b.text().trim() === "删除");
			await deleteBtns()[0].trigger("click"); // single delete — in flight
			await flushPromises();

			// Tick another unreferenced row and hit "删除选中": the single
			// delete still holds the bus, so the batch must NOT fire.
			const select = wrapper.find('button[aria-label="选择"]');
			await select.trigger("click");
			await flushPromises();
			const batchBtn = wrapper.findAll("button").find((b) => b.text().trim() === "删除选中");
			expect(batchBtn).toBeDefined();
			await batchBtn?.trigger("click");
			await flushPromises();

			expect(batchDeleteMock).not.toHaveBeenCalled();
			expect(deleteMock).toHaveBeenCalledTimes(1);

			resolveDelete({ message: "ok" });
			await flushPromises();
			expect(deleteMock).toHaveBeenCalledTimes(1);
		} finally {
			window.confirm = originalConfirm;
		}
	});

	it("batch-deletes selected unreferenced images (DEC-191)", async () => {
		const refresh = vi.fn(() => Promise.resolve());
		listMock.mockReturnValue(
			fakeListing(
				[
					{ ...unreferenced, url: unreferenced.url },
					{ ...referenced, url: referenced.url },
				],
				refresh,
			),
		);
		batchDeleteMock.mockResolvedValue({ deleted: 2 });
		const originalConfirm = window.confirm;
		window.confirm = vi.fn(() => true);

		try {
			const wrapper = await mountPage();
			// Referenced images have no select checkbox; unreferenced ones do.
			const selects = wrapper.findAll('button[aria-label="选择"]');
			expect(selects.length).toBe(1);
			await selects[0].trigger("click");
			expect(wrapper.text()).toContain("已选 1 张");

			const batchBtn = wrapper.findAll("button").find((b) => b.text().trim() === "删除选中");
			if (!batchBtn) throw new Error("expected a 删除选中 button");
			await batchBtn.trigger("click");
			await flushPromises();

			expect(batchDeleteMock).toHaveBeenCalledWith([unreferenced.url]);
			expect(refresh).toHaveBeenCalled();
		} finally {
			window.confirm = originalConfirm;
		}
	});

	it("shows the loading message while the listing is pending", async () => {
		listMock.mockReturnValue({ ...mockFetchResult(null, { pending: true }) });
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("正在加载媒体");
	});

	it("renders load error with Retry and never the empty state (regression: pre-fix union)", async () => {
		const refresh = vi.fn(() => Promise.resolve());
		listMock.mockReturnValue({
			...mockFetchResult(
				{ items: [], pagination: { total: 0, page: 1, limit: 60, total_pages: 0 } },
				{ error: new Error("boom") },
			),
			refresh,
		});
		const wrapper = await mountPage();

		// The failure is surfaced...
		expect(wrapper.text()).toContain("加载媒体失败");
		// ...while the empty title must NOT share the frame (the pre-fix bug
		// rendered "Failed to load media" directly above "No uploads yet").
		expect(wrapper.text()).not.toContain("还没有上传的图片");

		// Retry is wired to the real refresh — no reload-only dead end.
		const retry = wrapper.findAll("button").find((b) => b.text().includes("重试"));
		if (!retry) throw new Error("expected a 重试 button");
		await retry.trigger("click");
		expect(refresh).toHaveBeenCalled();
	});

	it("filters by filename through the debounced search box (DEC-189)", async () => {
		listMock.mockReturnValue(fakeListing([]));
		const wrapper = await mountPage();
		const input = wrapper.find('input[type="search"]');
		expect(input.exists()).toBe(true);
		expect(input.attributes("placeholder")).toBe("按文件名搜索...");
		expect(wrapper.text()).toContain("还没有上传的图片");

		// Typing arms the 300ms debounce; once it fires, `q` is set and the
		// empty state flips to the "no match" variant.
		await input.setValue("zzzz-no-such-file");
		await new Promise((r) => setTimeout(r, 400));
		expect(wrapper.text()).toContain("没有匹配的图片");
	});

	describe("Branch-gap coverage", () => {
		it("deselects an image when its select button is clicked again", async () => {
			listMock.mockReturnValue(fakeListing([{ ...unreferenced }]));
			const wrapper = await mountPage();

			const select = wrapper.find('button[aria-label="选择"]');
			await select.trigger("click");
			expect(wrapper.text()).toContain("已选 1 张");
			await select.trigger("click");
			expect(wrapper.text()).not.toContain("已选 1 张");
			expect(wrapper.findAll("button").find((b) => b.text().trim() === "删除选中")).toBeUndefined();
		});

		it("does not delete an image when the confirmation is cancelled", async () => {
			listMock.mockReturnValue(fakeListing([{ ...unreferenced }]));
			deleteMock.mockResolvedValue({});
			const originalConfirm = window.confirm;
			window.confirm = vi.fn(() => false);
			try {
				const wrapper = await mountPage();
				const deleteBtn = wrapper.findAll("button").find((b) => b.text().trim() === "删除");
				await deleteBtn?.trigger("click");
				await flushPromises();
				expect(window.confirm).toHaveBeenCalledWith("确认删除这张图片？");
				expect(deleteMock).not.toHaveBeenCalled();
			} finally {
				window.confirm = originalConfirm;
			}
		});

		it("surfaces a single-delete failure as an inline alert", async () => {
			listMock.mockReturnValue(fakeListing([{ ...unreferenced }]));
			deleteMock.mockRejectedValue(new Error("disk full"));
			const originalConfirm = window.confirm;
			window.confirm = vi.fn(() => true);
			try {
				const wrapper = await mountPage();
				const deleteBtn = wrapper.findAll("button").find((b) => b.text().trim() === "删除");
				await deleteBtn?.trigger("click");
				await flushPromises();
				expect(wrapper.find('[role="alert"]').exists()).toBe(true);
				expect(wrapper.text()).toContain("disk full");
			} finally {
				window.confirm = originalConfirm;
			}
		});

		it("surfaces a batch-delete failure as an inline alert", async () => {
			listMock.mockReturnValue(
				fakeListing([
					{ ...unreferenced },
					{
						...unreferenced,
						url: "/static/uploads/2026/07/11111111-2222-4444-8888-000000000003.png",
					},
				]),
			);
			batchDeleteMock.mockRejectedValue(new Error("batch boom"));
			const originalConfirm = window.confirm;
			window.confirm = vi.fn(() => true);
			try {
				const wrapper = await mountPage();
				const selects = wrapper.findAll('button[aria-label="选择"]');
				await selects[0].trigger("click");
				const batchBtn = wrapper.findAll("button").find((b) => b.text().trim() === "删除选中");
				await batchBtn?.trigger("click");
				await flushPromises();
				expect(wrapper.text()).toContain("batch boom");
			} finally {
				window.confirm = originalConfirm;
			}
		});

		it("omits the dimensions suffix when the image has no size metadata", async () => {
			listMock.mockReturnValue(
				fakeListing([{ ...unreferenced, width: null, height: null, size: 512 }]),
			);
			const wrapper = await mountPage();
			// formatSize(512) renders; the "W×H · " prefix is dropped.
			expect(wrapper.text()).toContain("512 B");
			expect(wrapper.text()).not.toContain("600×300");
		});

		it("tolerates an unparseable uploaded_at date", async () => {
			listMock.mockReturnValue(fakeListing([{ ...unreferenced, uploaded_at: "not-a-date" }]));
			const wrapper = await mountPage();
			expect(wrapper.text()).toContain(unreferenced.filename);
			// The date fallback renders an empty label instead of crashing.
			expect(wrapper.text()).toContain("上传于");
		});

		it("copies a URL, shows 已复制, then clears after the 1.5s window", async () => {
			const writeText = vi.fn().mockResolvedValue(undefined);
			Object.defineProperty(navigator, "clipboard", {
				value: { writeText },
				configurable: true,
			});
			listMock.mockReturnValue(fakeListing([{ ...unreferenced }]));
			vi.useFakeTimers();
			try {
				const wrapper = await mountPage();
				const copyBtn = wrapper.findAll("button").find((b) => b.text().trim() === "复制链接");
				expect(copyBtn).toBeDefined();
				await copyBtn?.trigger("click");
				await flushPromises();

				expect(writeText).toHaveBeenCalledWith(unreferenced.url);
				expect(wrapper.text()).toContain("链接已复制");

				vi.advanceTimersByTime(1500);
				await flushPromises();
				expect(wrapper.findAll("button").find((b) => b.text().trim() === "复制链接")).toBeDefined();
				expect(wrapper.text()).not.toContain("链接已复制");
			} finally {
				vi.useRealTimers();
			}
		});

		it("renders pager controls and clamps out-of-range page navigation", async () => {
			listMock.mockReturnValue(
				mockFetchResult({
					items: [{ ...unreferenced }],
					pagination: { total: 120, page: 1, limit: 60, total_pages: 3 },
				}),
			);
			const wrapper = await mountPage();
			expect(wrapper.text()).toContain("1 / 3");

			const next = wrapper.findAll("button").find((b) => b.text().trim() === "下一页");
			const prev = wrapper.findAll("button").find((b) => b.text().trim() === "上一页");
			expect(next).toBeDefined();
			expect(prev).toBeDefined();

			// page 1 → prev is clamped (goToPage(0) early-returns).
			await prev?.trigger("click");
			expect(wrapper.text()).toContain("1 / 3");

			await next?.trigger("click");
			expect(wrapper.text()).toContain("2 / 3");
			await next?.trigger("click");
			expect(wrapper.text()).toContain("3 / 3");

			// At the last page, next stays clamped.
			await next?.trigger("click");
			expect(wrapper.text()).toContain("3 / 3");
		});
	});
});
