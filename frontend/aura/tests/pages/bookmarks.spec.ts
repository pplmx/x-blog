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

import type { Bookmark } from "../../composables/useBookmarks";
import Bookmarks from "../../app/pages/bookmarks.vue";

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
	});
});
