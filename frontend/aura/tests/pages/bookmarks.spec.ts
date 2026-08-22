/**
 * Bookmarks page tests
 * Tests rendering of empty state, bookmark list, remove button, and clear-all.
 *
 * Mocks useBookmarks and useSeo composables, stubs Icon and NuxtLink.
 */

import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";

// Mock useBookmarks composable
const mockBookmarks = ref([]);
const mockRemoveBookmark = vi.fn();
const mockClearBookmarks = vi.fn();
const mockBookmarkCount = computed(() => mockBookmarks.value.length);

vi.mock("../../composables/useBookmarks", () => ({
	useBookmarks: () => ({
		bookmarks: mockBookmarks,
		removeBookmark: mockRemoveBookmark,
		clearBookmarks: mockClearBookmarks,
		bookmarkCount: mockBookmarkCount,
	}),
}));

// Mock useSeo composable
vi.mock("../../composables/useSeo", () => ({
	useSeo: vi.fn(),
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

		it("calls clearBookmarks when clear all is confirmed", async () => {
			mockBookmarks.value = [sampleBookmark];
			mockClearBookmarks.mockClear();
			vi.stubGlobal("confirm", () => true);

			const wrapper = mountBookmarks();
			await wrapper.find("button[title='清空全部']").trigger("click");

			expect(mockClearBookmarks).toHaveBeenCalled();
			vi.unstubAllGlobals();
		});

		it("does not call clearBookmarks when clear all is cancelled", async () => {
			mockBookmarks.value = [sampleBookmark];
			mockClearBookmarks.mockClear();
			vi.stubGlobal("confirm", () => false);

			const wrapper = mountBookmarks();
			await wrapper.find("button[title='清空全部']").trigger("click");

			expect(mockClearBookmarks).not.toHaveBeenCalled();
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
});
