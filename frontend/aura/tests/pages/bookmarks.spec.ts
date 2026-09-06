/**
 * Bookmarks page tests
 * Tests rendering of empty state, bookmark list, remove button, and clear-all.
 *
 * Mocks useBookmarks and useSeo composables, stubs Icon and NuxtLink.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";

// Mock useBookmarks composable
const mockBookmarks = ref([]);
const mockRemoveBookmark = vi.fn();
const mockAddBookmark = vi.fn();
const mockClearAll = vi.fn();
const mockBookmarkCount = computed(() => mockBookmarks.value.length);

vi.mock("../../composables/useBookmarks", () => ({
	useBookmarks: () => ({
		bookmarks: mockBookmarks,
		removeBookmark: mockRemoveBookmark,
		bookmarkCount: mockBookmarkCount,
	}),
}));

// Mock useBookmarkSync: the page's "Clear all" now goes through clearAll
// (local wipe + cloud clear, TASK-233), not a bare clearBookmarks. `add` backs
// the single-removal Undo.
const mockSyncing = ref(false);
const mockSyncIssue = ref<"auth" | null>(null);
const mockClearSyncIssue = vi.fn();
vi.mock("../../composables/useBookmarkSync", () => ({
	useBookmarkSync: () => ({
		bookmarks: mockBookmarks,
		add: mockAddBookmark,
		remove: mockRemoveBookmark,
		clearAll: mockClearAll,
		mergeLocalToCloud: vi.fn(() => Promise.resolve()),
		syncing: mockSyncing,
		syncIssue: mockSyncIssue,
		clearSyncIssue: mockClearSyncIssue,
	}),
}));

// Mock useSeo composable
vi.mock("../../composables/useSeo", () => ({
	useSeo: vi.fn(),
}));

// Reactive reader-auth so the page's sign-out watcher can be driven in-test.
const mockIsAuthenticated = ref(true);
vi.mock("../../composables/useReaderAuth", () => ({
	useReaderAuth: () => ({ isAuthenticated: mockIsAuthenticated, logout: vi.fn() }),
}));

// Folder API: create/rename failures return false and must surface an alert;
// assign is hoisted so the undo-restores-folder regression (ISS-388) can assert
// the re-created cloud row is re-filed. Mirrors bookmarks-folders.spec.ts.
const mockFolders = ref<{ id: number; name: string; count: number }[]>([]);
const mockCreateFolder = vi.fn(async () => false);
const mockAssignFolder = vi.fn(async () => true);
vi.mock("../../composables/useBookmarkFolders", () => ({
	useBookmarkFolders: () => ({
		folders: mockFolders,
		loading: ref(false),
		load: vi.fn(),
		create: mockCreateFolder,
		rename: vi.fn(async () => true),
		remove: vi.fn(async () => true),
		assign: mockAssignFolder,
	}),
}));

import Bookmarks from "../../app/pages/bookmarks.vue";
import type { Bookmark } from "../../composables/useBookmarks";

const stubs = {
	Icon: {
		template: '<svg class="icon-stub" />',
	},
	NuxtLink: {
		template: '<a class="nuxt-link-stub"><slot/></a>',
	},
};

function mountBookmarks() {
	return mount(Bookmarks, {
		global: { stubs },
	});
}

const sampleBookmark: Bookmark = {
	id: 1,
	title: "Test Bookmarked Post",
	slug: "test-bookmarked-post",
	excerpt: "This is a bookmarked post excerpt.",
	cover_image: null,
	created_at: "2024-01-15T10:00:00Z",
	category: { id: 1, name: "Tech" },
	tags: [{ id: 1, name: "vue" }],
};

describe("Bookmarks page", () => {
	describe("rendering", () => {
		it("renders without errors", () => {
			mockBookmarks.value = [];
			const wrapper = mountBookmarks();
			expect(wrapper.exists()).toBe(true);
		});

		it("renders the page title", () => {
			mockBookmarks.value = [];
			const wrapper = mountBookmarks();
			expect(wrapper.text()).toContain("收藏的文章");
		});
	});

	describe("empty state", () => {
		it("shows empty state when no bookmarks", () => {
			mockBookmarks.value = [];
			const wrapper = mountBookmarks();
			expect(wrapper.text()).toContain("还没有收藏的文章");
			expect(wrapper.text()).toContain("去浏览文章");
		});

		it("does not show clear all button when no bookmarks", () => {
			mockBookmarks.value = [];
			const wrapper = mountBookmarks();
			expect(wrapper.find("button[title='清空全部']").exists()).toBe(false);
		});

		it("shows a syncing placeholder instead of the empty state while the cloud merge runs", () => {
			// A signed-in reader on a fresh device has an empty LOCAL list until
			// mergeLocalToCloud pulls the server copy down; the empty state must
			// not flash "you have no bookmarks yet" during that window.
			mockBookmarks.value = [];
			mockSyncing.value = true;
			const wrapper = mountBookmarks();
			expect(wrapper.text()).toContain("正在同步收藏");
			expect(wrapper.text()).not.toContain("还没有收藏的文章");
			mockSyncing.value = false;
		});

		it("warns (with a re-login link) when the cloud sync hits a dead session and dismisses on X", async () => {
			// ISS-222: a stored-but-expired reader token silently drops mirror
			// writes. The page must surface it instead of pretending "saved".
			mockBookmarks.value = [];
			mockSyncIssue.value = "auth";
			const wrapper = mountBookmarks();
			const alert = wrapper.find("[role='alert']");
			expect(alert.exists()).toBe(true);
			expect(alert.text()).toContain("登录已过期");
			expect(alert.find(".nuxt-link-stub").exists()).toBe(true);

			mockClearSyncIssue.mockClear();
			await alert.find("button").trigger("click");
			expect(mockClearSyncIssue).toHaveBeenCalled();

			mockSyncIssue.value = null;
		});

		it("stays quiet when cloud sync has no issue", () => {
			mockBookmarks.value = [];
			mockSyncIssue.value = null;
			const wrapper = mountBookmarks();
			expect(wrapper.find("[role='alert']").exists()).toBe(false);
		});

		it("shows the real empty state once sync finishes", () => {
			mockBookmarks.value = [];
			mockSyncing.value = false;
			const wrapper = mountBookmarks();
			expect(wrapper.text()).toContain("还没有收藏的文章");
			expect(wrapper.text()).not.toContain("正在同步收藏");
		});
	});

	describe("with bookmarks", () => {
		it("shows bookmark count", () => {
			mockBookmarks.value = [sampleBookmark];
			const wrapper = mountBookmarks();
			expect(wrapper.text()).toContain("共 1 篇文章");
		});

		it("renders bookmark title", () => {
			mockBookmarks.value = [sampleBookmark];
			const wrapper = mountBookmarks();
			expect(wrapper.text()).toContain("Test Bookmarked Post");
		});

		it("renders bookmark excerpt", () => {
			mockBookmarks.value = [sampleBookmark];
			const wrapper = mountBookmarks();
			expect(wrapper.text()).toContain("This is a bookmarked post excerpt.");
		});

		it("renders bookmark category", () => {
			mockBookmarks.value = [sampleBookmark];
			const wrapper = mountBookmarks();
			expect(wrapper.text()).toContain("Tech");
		});

		it("renders bookmark tags", () => {
			mockBookmarks.value = [sampleBookmark];
			const wrapper = mountBookmarks();
			expect(wrapper.text()).toContain("#vue");
		});

		it("renders remove button with correct title", () => {
			mockBookmarks.value = [sampleBookmark];
			const wrapper = mountBookmarks();
			expect(wrapper.find("button[title='移除收藏']").exists()).toBe(true);
		});

		it("renders clear all button", () => {
			mockBookmarks.value = [sampleBookmark];
			const wrapper = mountBookmarks();
			expect(wrapper.find("button[title='清空全部']").exists()).toBe(true);
		});
	});

	describe("interactions", () => {
		it("calls removeBookmark when remove button is clicked", async () => {
			mockBookmarks.value = [sampleBookmark];
			mockRemoveBookmark.mockClear();
			const wrapper = mountBookmarks();
			await wrapper.find("button[title='移除收藏']").trigger("click");
			expect(mockRemoveBookmark).toHaveBeenCalledWith(1);
		});

		it("offers an inline Undo after a one-click removal and restores via add", async () => {
			mockBookmarks.value = [sampleBookmark];
			mockRemoveBookmark.mockClear();
			mockAddBookmark.mockClear();

			const wrapper = mountBookmarks();
			await wrapper.find("button[title='移除收藏']").trigger("click");
			// The removed bookmark is kept with a visible Undo affordance.
			const undoBtn = wrapper.findAll("button").find((b) => b.text().includes("撤销"));
			expect(undoBtn).toBeDefined();
			await undoBtn?.trigger("click");

			// Undo re-adds the same bookmark (which mirrors back to the cloud).
			expect(mockAddBookmark).toHaveBeenCalledWith(sampleBookmark);
			// And the undo banner is dismissed.
			expect(wrapper.find("[role='status']").exists()).toBe(false);
		});

		it("restores a removed bookmark's folder assignment on undo (ISS-388)", async () => {
			// A bookmark inside a folder that gets removed + undone: the undo's
			// add() re-PUTs only the post id, so without an explicit folder
			// re-assign the cloud row loses its folder and the next merge pull
			// silently un-files it. The undo must re-apply the folder on the
			// re-created cloud row.
			const folded = { ...sampleBookmark, folder_id: 3, folder_name: "Reading" };
			mockBookmarks.value = [folded];
			mockRemoveBookmark.mockClear();
			mockAddBookmark.mockClear();
			mockAssignFolder.mockClear();

			const wrapper = mountBookmarks();
			await wrapper.find("button[title='移除收藏']").trigger("click");
			const undoBtn = wrapper.findAll("button").find((b) => b.text().includes("撤销"));
			expect(undoBtn).toBeDefined();
			await undoBtn?.trigger("click");
			await flushPromises();

			expect(mockAddBookmark).toHaveBeenCalledWith(folded);
			expect(mockAssignFolder).toHaveBeenCalledWith(1, 3);
		});

		it("calls clearAll when clear all is confirmed", async () => {
			mockBookmarks.value = [sampleBookmark];
			mockClearAll.mockClear();
			mockClearAll.mockResolvedValueOnce(true);
			vi.stubGlobal("confirm", () => true);

			const wrapper = mountBookmarks();
			await wrapper.find("button[title='清空全部']").trigger("click");
			await flushPromises();

			expect(mockClearAll).toHaveBeenCalled();
			vi.unstubAllGlobals();
		});

		it("warns when the cloud copy survives an offline clear-all (ISS-387)", async () => {
			// The local mirror is wiped, but the server copy is still there and
			// the next merge resurrects it — the page must not present the wipe
			// as a done deal.
			mockBookmarks.value = [sampleBookmark];
			mockClearAll.mockClear();
			mockClearAll.mockResolvedValueOnce(false);
			vi.stubGlobal("confirm", () => true);

			const wrapper = mountBookmarks();
			await wrapper.find("button[title='清空全部']").trigger("click");
			await flushPromises();

			expect(mockClearAll).toHaveBeenCalled();
			expect(wrapper.find("[role='alert']").text()).toContain("联网后重新同步回来");
			vi.unstubAllGlobals();
		});

		it("does not call clearAll when clear all is cancelled", async () => {
			mockBookmarks.value = [sampleBookmark];
			mockClearAll.mockClear();
			vi.stubGlobal("confirm", () => false);

			const wrapper = mountBookmarks();
			await wrapper.find("button[title='清空全部']").trigger("click");

			expect(mockClearAll).not.toHaveBeenCalled();
			vi.unstubAllGlobals();
		});
	});

	describe("search (TASK-174)", () => {
		const vueBookmark = { ...sampleBookmark, id: 1, title: "Vue Guide", slug: "vue-guide" };
		const goBookmark = {
			...sampleBookmark,
			id: 2,
			title: "Go Internals",
			slug: "go-internals",
			category: { id: 2, name: "Backend" },
			tags: [],
		};

		it("filters bookmarks by title keyword", async () => {
			mockBookmarks.value = [vueBookmark, goBookmark];
			const wrapper = mountBookmarks();
			await wrapper.find('input[type="search"]').setValue("Vue");
			expect(wrapper.text()).toContain("Vue Guide");
			expect(wrapper.text()).not.toContain("Go Internals");
		});

		it("filters bookmarks by category name", async () => {
			mockBookmarks.value = [vueBookmark, goBookmark];
			const wrapper = mountBookmarks();
			await wrapper.find('input[type="search"]').setValue("Backend");
			expect(wrapper.text()).toContain("Go Internals");
			expect(wrapper.text()).not.toContain("Vue Guide");
		});

		it("shows a no-results message and clears the search", async () => {
			mockBookmarks.value = [vueBookmark, goBookmark];
			const wrapper = mountBookmarks();
			await wrapper.find('input[type="search"]').setValue("zzz");
			expect(wrapper.text()).toContain("没有匹配的收藏。");
			await wrapper.find('button[aria-label="清除搜索"]').trigger("click");
			expect(wrapper.text()).toContain("Go Internals");
			expect(wrapper.text()).toContain("Vue Guide");
		});

		it("hidden when there are no bookmarks", () => {
			mockBookmarks.value = [];
			const wrapper = mountBookmarks();
			expect(wrapper.find('input[type="search"]').exists()).toBe(false);
		});
	});

	describe("folder sign-out state (deep-dive finding)", () => {
		const folderBookmark = {
			...sampleBookmark,
			id: 1,
			folder_id: 1 as number | null,
			folder_name: "AI" as string | null,
		};
		const looseBookmark = {
			...sampleBookmark,
			id: 2,
			folder_id: null,
			folder_name: null,
			title: "No Folder Post",
		};

		afterEach(() => {
			mockIsAuthenticated.value = true;
			mockFolders.value = [];
		});

		it("resets the active folder filter on sign-out so the list is not trapped behind a hidden bar", async () => {
			mockBookmarks.value = [folderBookmark, looseBookmark];
			mockFolders.value = [{ id: 1, name: "AI", count: 1 }];
			const wrapper = mountBookmarks();
			// Select the AI folder chip → only the filed bookmark shows.
			await wrapper
				.findAll("button")
				.find((b) => b.text().includes("AI"))
				?.trigger("click");
			expect(wrapper.text()).toContain("Test Bookmarked Post");
			expect(wrapper.text()).not.toContain("No Folder Post");

			// Sign out in the header: the folder bar (and its "All" chip) vanishes,
			// so the active filter must reset or the list stays invisibly filtered.
			mockIsAuthenticated.value = false;
			await flushPromises();
			expect(wrapper.text()).toContain("No Folder Post");
		});

		it("shows an alert when folder creation fails instead of a silent no-op", async () => {
			mockBookmarks.value = [folderBookmark];
			mockIsAuthenticated.value = true;
			mockCreateFolder.mockResolvedValueOnce(false);
			vi.stubGlobal("prompt", () => "New Folder");
			const wrapper = mountBookmarks();
			await wrapper
				.findAll("button")
				.find((b) => b.text().includes("新建文件夹"))
				?.trigger("click");
			await flushPromises();
			expect(wrapper.text()).toContain("文件夹操作失败，请检查网络后重试。");
			expect(mockCreateFolder).toHaveBeenCalledWith("New Folder");
			vi.unstubAllGlobals();
		});
	});
});
