/**
 * Bookmark-folder UI tests (DEC-120, TASK-172).
 *
 * A signed-in reader sees the folder bar, can filter bookmarks by folder,
 * create/rename/delete folders, and file a bookmark into (or out of) a folder.
 * Guests see none of this. useBookmarks/useBookmarkSync/useBookmarkFolders and
 * useSeo are mocked; the reader token is set so the page treats the visitor as
 * signed in.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import type { BookmarkFolder } from "../../api/reader/bookmarks";
import type { Bookmark } from "../../composables/useBookmarks";

const READER_TOKEN_KEY = "reader_token";

const mockBookmarks = ref<Bookmark[]>([]);
const mockFolders = ref<BookmarkFolder[]>([]);
const mockBookmarkCount = computed(() => mockBookmarks.value.length);
const mockRemove = vi.fn();
const mockMerge = vi.fn();
const mockAdd = vi.fn();
const mockClearAll = vi.fn();
const mockSyncing = ref(false);
const mockSyncIssue = ref(null);
const mockClearSyncIssue = vi.fn();
const mockLoadFolders = vi.fn();
const mockCreateFolder = vi.fn();
const mockRenameFolder = vi.fn();
const mockRemoveFolder = vi.fn();
const mockAssignFolder = vi.fn(() => Promise.resolve(true));

vi.mock("../../composables/useBookmarks", () => ({
	useBookmarks: () => ({
		bookmarks: mockBookmarks,
		removeBookmark: mockRemove,
		clearBookmarks: vi.fn(),
		bookmarkCount: mockBookmarkCount,
	}),
}));

vi.mock("../../composables/useBookmarkSync", () => ({
	useBookmarkSync: () => ({
		remove: mockRemove,
		mergeLocalToCloud: mockMerge,
		add: mockAdd,
		clearAll: mockClearAll,
		syncing: mockSyncing,
		syncIssue: mockSyncIssue,
		clearSyncIssue: mockClearSyncIssue,
	}),
}));

vi.mock("../../composables/useBookmarkFolders", () => ({
	useBookmarkFolders: () => ({
		folders: mockFolders,
		loading: ref(false),
		load: mockLoadFolders,
		create: mockCreateFolder,
		rename: mockRenameFolder,
		remove: mockRemoveFolder,
		assign: mockAssignFolder,
	}),
}));

vi.mock("../../composables/useSeo", () => ({ useSeo: vi.fn() }));

import BookmarksPage from "../../app/pages/bookmarks.vue";

const stubs = {
	Icon: { template: '<svg class="icon-stub" />' },
	NuxtLink: { template: '<a class="nuxt-link-stub"><slot/></a>' },
};

function mountPage() {
	return mount(BookmarksPage, { global: { stubs } });
}

const folder = (id: number, name: string): BookmarkFolder => ({ id, name, count: 0 });
const bm = (id: number, title: string, folderId?: number | null): Bookmark => ({
	id,
	title,
	slug: `post-${id}`,
	excerpt: null,
	cover_image: null,
	created_at: "2024-01-15T10:00:00Z",
	folder_id: folderId ?? null,
	folder_name: folderId ? `Folder${folderId}` : null,
	category: { id: 1, name: "Tech" },
	tags: [],
});

describe("Bookmark folders page (TASK-172)", () => {
	beforeEach(() => {
		window.localStorage.setItem(READER_TOKEN_KEY, "reader-token");
		mockBookmarks.value = [];
		mockFolders.value = [];
		// resetAllMocks (not clearAllMocks) so a hanging implementation set by one
		// test (e.g. the never-resolving mockAssignFolder in the single-flight
		// test) cannot leak into the next and make it time out (deep-dive finding).
		vi.resetAllMocks();
		mockAssignFolder.mockImplementation(() => Promise.resolve(true));
		mockSyncing.value = false;
		mockSyncIssue.value = null;
		// happy-dom has no prompt/confirm; provide them for the page's dialogs.
		(window as unknown as { prompt: () => string | null }).prompt = vi.fn(() => null);
		(window as unknown as { confirm: () => boolean }).confirm = vi.fn(() => false);
	});

	afterEach(() => {
		window.localStorage.removeItem(READER_TOKEN_KEY);
		vi.restoreAllMocks();
	});

	it("shows the folder bar for a signed-in reader", () => {
		mockFolders.value = [folder(1, "Go"), folder(2, "Frontend")];
		mockBookmarks.value = [bm(1, "A", 1), bm(2, "B", null)];
		const wrapper = mountPage();
		expect(wrapper.text()).toContain("新建文件夹");
		expect(wrapper.text()).toContain("Go");
		expect(wrapper.text()).toContain("Frontend");
	});

	it("does not show the folder bar for a guest", () => {
		window.localStorage.removeItem(READER_TOKEN_KEY);
		mockFolders.value = [folder(1, "Go")];
		mockBookmarks.value = [bm(1, "A")];
		const wrapper = mountPage();
		expect(wrapper.text()).not.toContain("新建文件夹");
	});

	it("filters bookmarks by the selected folder", async () => {
		mockFolders.value = [folder(1, "Go")];
		mockBookmarks.value = [bm(1, "InGo", 1), bm(2, "Uncategorized", null)];
		const wrapper = mountPage();
		expect(wrapper.text()).toContain("InGo");
		expect(wrapper.text()).toContain("Uncategorized");
		// Click the "Go" folder chip.
		const chip = wrapper.findAll("button").find((b) => b.text().includes("Go"));
		await chip?.trigger("click");
		expect(wrapper.text()).toContain("InGo");
		expect(wrapper.text()).not.toContain("Uncategorized");
	});

	it("creates a folder via the new-folder prompt", async () => {
		mockFolders.value = [];
		mockBookmarks.value = [bm(1, "A")];
		(window as unknown as { prompt: () => string | null }).prompt = vi.fn(() => "Reading");
		const wrapper = mountPage();
		await wrapper
			.findAll("button")
			.find((b) => b.text().includes("新建文件夹"))
			?.trigger("click");
		expect(mockCreateFolder).toHaveBeenCalledWith("Reading");
	});

	it("renames a folder", async () => {
		mockFolders.value = [folder(1, "Old")];
		mockBookmarks.value = [bm(1, "A", 1)];
		(window as unknown as { prompt: () => string | null }).prompt = vi.fn(() => "New");
		const wrapper = mountPage();
		// Open manage panel, then rename.
		await wrapper
			.findAll("button")
			.find((b) => b.text().includes("管理文件夹"))
			?.trigger("click");
		await wrapper
			.findAll("button")
			.find((b) => b.text().includes("重命名"))
			?.trigger("click");
		expect(mockRenameFolder).toHaveBeenCalledWith(1, "New");
	});

	it("deletes a folder after confirmation", async () => {
		mockFolders.value = [folder(1, "Go")];
		mockBookmarks.value = [bm(1, "A", 1)];
		(window as unknown as { confirm: () => boolean }).confirm = vi.fn(() => true);
		const wrapper = mountPage();
		await wrapper
			.findAll("button")
			.find((b) => b.text().includes("管理文件夹"))
			?.trigger("click");
		await wrapper
			.findAll("button")
			.find((b) => b.text().includes("删除"))
			?.trigger("click");
		expect(mockRemoveFolder).toHaveBeenCalledWith(1);
	});

	it("assigns a bookmark to a folder via the row select", async () => {
		mockFolders.value = [folder(2, "Frontend")];
		mockBookmarks.value = [bm(1, "A", null)];
		const wrapper = mountPage();
		const select = wrapper.find("select");
		await select.setValue("2");
		expect(mockAssignFolder).toHaveBeenCalledWith(1, 2);
	});

	it("rolls back the folder select and shows an error when the server rejects the assign", async () => {
		// The row select updates optimistically; a failed server call must
		// restore the prior folder and surface the failure (deep-dive finding).
		mockFolders.value = [folder(2, "Frontend")];
		mockBookmarks.value = [bm(1, "A", null)];
		mockAssignFolder.mockResolvedValueOnce(false);
		const wrapper = mountPage();

		const select = wrapper.find("select");
		await select.setValue("2");
		await flushPromises();
		expect(wrapper.text()).toContain("移动收藏失败");
		// The optimistic change was rolled back to "no folder".
		expect((select.element as HTMLSelectElement).value).toBe("");
	});

	it("disables the row's select while its folder assignment is in flight (deep-dive)", async () => {
		// Two rapid changes on the same row clobbered each other's optimistic
		// state; the select is disabled while the PATCH is pending (single-flight
		// per row, and the row's aria-busy reflects it).
		mockFolders.value = [folder(2, "Frontend")];
		mockBookmarks.value = [bm(1, "A", null)];
		let resolveAssign!: (v: unknown) => void;
		mockAssignFolder.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveAssign = resolve;
				}),
		);
		const wrapper = mountPage();

		const select = wrapper.find("select");
		await select.setValue("2");
		await flushPromises();
		expect((select.element as HTMLSelectElement).disabled).toBe(true);
		expect(select.attributes("aria-busy")).toBe("true");

		resolveAssign(true);
		await flushPromises();
		expect((select.element as HTMLSelectElement).disabled).toBe(false);
	});

	it("syncs bookmark folder_name after a successful rename (deep-dive)", async () => {
		// The folder list refreshes on rename, but the local bookmark rows kept
		// the old name — chips must agree with the manage panel. The mock models
		// the real rename()->load() reload of the folder list.
		mockFolders.value = [folder(1, "Old")];
		mockBookmarks.value = [bm(1, "A", 1)];
		mockRenameFolder.mockImplementation(async (id: number, name: string) => {
			mockFolders.value = mockFolders.value.map((f) => (f.id === id ? { ...f, name } : f));
			return true;
		});
		(window as unknown as { prompt: () => string | null }).prompt = vi.fn(() => "New");
		const wrapper = mountPage();

		await wrapper
			.findAll("button")
			.find((b) => b.text().includes("管理文件夹"))
			?.trigger("click");
		await wrapper
			.findAll("button")
			.find((b) => b.text().includes("重命名"))
			?.trigger("click");
		await flushPromises();

		expect(mockRenameFolder).toHaveBeenCalledWith(1, "New");
		expect(mockBookmarks.value[0].folder_name).toBe("New");
		expect(wrapper.text()).toContain("New");
		expect(wrapper.text()).not.toContain("Old");
	});

	it("unfiles bookmarks from a deleted folder (deep-dive)", async () => {
		mockFolders.value = [folder(1, "Go")];
		mockBookmarks.value = [bm(1, "A", 1)];
		mockRemoveFolder.mockResolvedValue(true);
		(window as unknown as { confirm: () => boolean }).confirm = vi.fn(() => true);
		const wrapper = mountPage();

		await wrapper
			.findAll("button")
			.find((b) => b.text().includes("管理文件夹"))
			?.trigger("click");
		await wrapper
			.findAll("button")
			.find((b) => b.text().includes("删除"))
			?.trigger("click");
		await flushPromises();

		// The deleted folder's rows are implicitly unfiled — no stale chip, no
		// select binding to an option that no longer exists. (The mock's folder
		// list still holds "Go"; the assertion targets the bookmark row's chip,
		// which the real removeFolder+load() would also drop.)
		expect(mockBookmarks.value[0].folder_id).toBeNull();
		expect(mockBookmarks.value[0].folder_name).toBeNull();
		expect(wrapper.text()).not.toContain("Folder1");
	});

	it("keeps the folder filter and shows an error when the delete fails (deep-dive)", async () => {
		mockFolders.value = [folder(1, "Go")];
		mockBookmarks.value = [bm(1, "A", 1)];
		mockRemoveFolder.mockResolvedValue(false); // offline / server error
		(window as unknown as { confirm: () => boolean }).confirm = vi.fn(() => true);
		const wrapper = mountPage();

		// Filter to the "Go" folder first.
		const chip = wrapper.findAll("button").find((b) => b.text().includes("Go"));
		await chip?.trigger("click");
		await wrapper
			.findAll("button")
			.find((b) => b.text().includes("管理文件夹"))
			?.trigger("click");
		await wrapper
			.findAll("button")
			.find((b) => b.text().includes("删除"))
			?.trigger("click");
		await flushPromises();

		// The failed delete must NOT unfile rows nor drop the filter, and the
		// failure is surfaced (the old path swallowed it and reset the filter).
		expect(mockBookmarks.value[0].folder_id).toBe(1);
		expect(wrapper.text()).toContain("文件夹操作失败，请检查网络后重试。");
		expect(wrapper.text()).toContain("A");
	});
});
