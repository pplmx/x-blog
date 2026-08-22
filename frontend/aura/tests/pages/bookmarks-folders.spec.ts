/**
 * Bookmark-folder UI tests (DEC-120, TASK-172).
 *
 * A signed-in reader sees the folder bar, can filter bookmarks by folder,
 * create/rename/delete folders, and file a bookmark into (or out of) a folder.
 * Guests see none of this. useBookmarks/useBookmarkSync/useBookmarkFolders and
 * useSeo are mocked; the reader token is set so the page treats the visitor as
 * signed in.
 */

import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import type { BookmarkFolder } from "../../composables/useApi";
import type { Bookmark } from "../../composables/useBookmarks";

const READER_TOKEN_KEY = "reader_token";

const mockBookmarks = ref<Bookmark[]>([]);
const mockFolders = ref<BookmarkFolder[]>([]);
const mockBookmarkCount = computed(() => mockBookmarks.value.length);
const mockRemove = vi.fn();
const mockMerge = vi.fn();
const mockLoadFolders = vi.fn();
const mockCreateFolder = vi.fn();
const mockRenameFolder = vi.fn();
const mockRemoveFolder = vi.fn();
const mockAssignFolder = vi.fn();

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
		vi.clearAllMocks();
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
});
