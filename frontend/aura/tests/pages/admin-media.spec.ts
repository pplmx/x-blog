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

vi.mock("../../api/admin/media", () => ({
	// useAdminMedia returns an AsyncData-like object the page destructures as
	// { data, pending, error, refresh }.
	useAdminMedia: (page: number, pageSize: number) => listMock(page, pageSize),
	deleteAdminMediaFile: deleteMock,
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
		const deleteBtn = wrapper.findAll("button").find((b) => b.text().trim() === "删除")!;
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
			const deleteBtn = wrapper.findAll("button").find((b) => b.text().trim() === "删除")!;
			expect(deleteBtn.attributes("disabled")).toBeUndefined();
			await deleteBtn.trigger("click");
			await flushPromises();

			expect(deleteMock).toHaveBeenCalledWith(
				unreferenced.year,
				unreferenced.month,
				unreferenced.filename,
			);
			expect(refresh).toHaveBeenCalled();
		} finally {
			window.confirm = originalConfirm;
		}
	});
});
