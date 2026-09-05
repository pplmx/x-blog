import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import BookmarkButton from "../../components/BookmarkButton.vue";
import { syncIssue } from "../../composables/useBookmarkSync";

const mockBookmark = {
	id: 1,
	title: "Test Post",
	slug: "test-post",
	excerpt: "An excerpt",
	cover_image: null,
	created_at: "2024-01-15T10:00:00Z",
	category: { id: 1, name: "Tech" },
	tags: [{ id: 1, name: "vue" }],
};

const stubs = {
	Icon: {
		template: '<svg class="icon-stub" :data-icon="icon"></svg>',
		props: ["icon"],
	},
};

describe("BookmarkButton", () => {
	let wrapper: VueWrapper;

	beforeEach(() => {
		localStorage.clear();
		syncIssue.value = null;
	});

	afterEach(() => {
		if (wrapper) wrapper.unmount();
		localStorage.clear();
		syncIssue.value = null;
	});

	describe("rendering", () => {
		it("renders without errors", () => {
			wrapper = mount(BookmarkButton, {
				props: { postId: 1, post: mockBookmark },
				global: { stubs },
			});
			expect(wrapper.exists()).toBe(true);
		});

		it("renders a button element", () => {
			wrapper = mount(BookmarkButton, {
				props: { postId: 1, post: mockBookmark },
				global: { stubs },
			});
			expect(wrapper.find("button").exists()).toBe(true);
		});

		it("renders outline bookmark icon when not bookmarked", () => {
			wrapper = mount(BookmarkButton, {
				props: { postId: 1, post: mockBookmark },
				global: { stubs },
			});
			const icon = wrapper.find(".icon-stub");
			expect(icon.attributes("data-icon")).toBe("lucide:bookmark");
		});

		it("renders filled bookmark icon when bookmarked", async () => {
			wrapper = mount(BookmarkButton, {
				props: { postId: 1, post: mockBookmark },
				global: { stubs },
			});
			// Click to bookmark
			await wrapper.find("button").trigger("click");
			await wrapper.vm.$nextTick();
			const icon = wrapper.find(".icon-stub");
			expect(icon.attributes("data-icon")).toBe("lucide:bookmark-check");
		});

		it("changes title to cancel when bookmarked", async () => {
			wrapper = mount(BookmarkButton, {
				props: { postId: 1, post: mockBookmark },
				global: { stubs },
			});
			expect(wrapper.find("button").attributes("title")).toBe("收藏文章");
			await wrapper.find("button").trigger("click");
			await wrapper.vm.$nextTick();
			expect(wrapper.find("button").attributes("title")).toBe("取消收藏");
		});

		it("has a title attribute for accessibility", () => {
			wrapper = mount(BookmarkButton, {
				props: { postId: 1, post: mockBookmark },
				global: { stubs },
			});
			expect(wrapper.find("button").attributes("title")).toBe("收藏文章");
		});

		it("hints that the sign-in expired when the shared sync warning is set (ISS-222)", async () => {
			// Dead-session flag is module-scoped: a 401 mirror failure anywhere
			// (another button, the bookmarks page) updates this button's hint.
			syncIssue.value = "auth";
			wrapper = mount(BookmarkButton, {
				props: { postId: 1, post: mockBookmark },
				global: { stubs },
			});
			const button = wrapper.find("button");
			expect(button.attributes("title")).toContain("登录已过期");
			expect(button.attributes("aria-label")).toContain("登录已过期");

			// A successful later mirror clears the hint for every button.
			syncIssue.value = null;
			await wrapper.vm.$nextTick();
			expect(button.attributes("title")).toBe("收藏文章");
		});
	});

	describe("click behavior", () => {
		it("toggles bookmark state on click", async () => {
			wrapper = mount(BookmarkButton, {
				props: { postId: 1, post: mockBookmark },
				global: { stubs },
			});
			const button = wrapper.find("button");
			// First click: bookmark
			await button.trigger("click");
			await wrapper.vm.$nextTick();
			expect(wrapper.find(".icon-stub").attributes("data-icon")).toBe("lucide:bookmark-check");
			// Second click: unbookmark
			await button.trigger("click");
			await wrapper.vm.$nextTick();
			expect(wrapper.find(".icon-stub").attributes("data-icon")).toBe("lucide:bookmark");
		});

		it("stops click propagation to prevent navigation", async () => {
			const stopPropagation = vi.fn();
			wrapper = mount(BookmarkButton, {
				props: { postId: 1, post: mockBookmark },
				global: { stubs },
			});
			const event = new MouseEvent("click", { bubbles: true });
			Object.defineProperty(event, "stopPropagation", { value: stopPropagation });
			wrapper.find("button").element.dispatchEvent(event);
			expect(stopPropagation).toHaveBeenCalled();
		});
	});

	describe("with variant full", () => {
		it("renders with label text when variant is full", () => {
			wrapper = mount(BookmarkButton, {
				props: { postId: 1, post: mockBookmark, variant: "full" },
				global: { stubs },
			});
			expect(wrapper.text()).toContain("收藏");
		});
	});
});
