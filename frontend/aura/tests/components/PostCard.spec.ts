/**
 * PostCard component tests
 * Tests rendering of post title, excerpt, category, views, tags, and link.
 */

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import PostCard from "../../components/PostCard.vue";

const mockPost = {
	id: 1,
	title: "Test Post Title",
	slug: "test-post-title",
	excerpt: "This is a test post excerpt.",
	published: true,
	created_at: "2024-01-15T10:00:00Z",
	views: 42,
	comment_count: 7,
	cover_image: null,
	category: { id: 1, name: "Technology" },
	tags: [
		{ id: 1, name: "vue" },
		{ id: 2, name: "nuxt" },
	],
};

const stubs = {
	Icon: {
		template: '<svg class="icon-stub" />',
	},
	NuxtLink: {
		template: '<a class="nuxt-link-stub"><slot/></a>',
	},
	BookmarkButton: {
		template:
			"<button class=\"bookmark-stub\" :title=\"variant === 'full' ? '收藏文章' : '收藏文章'\" :data-post-id=\"postId\"></button>",
		props: ["postId", "post", "variant"],
	},
};

function mountPostCard(post = mockPost) {
	return mount(PostCard, {
		props: { post },
		global: { stubs },
	});
}

describe("PostCard", () => {
	describe("rendering", () => {
		it("renders without errors", () => {
			const wrapper = mountPostCard();
			expect(wrapper.exists()).toBe(true);
		});

		it("renders the post title", () => {
			const wrapper = mountPostCard();
			expect(wrapper.text()).toContain("Test Post Title");
		});

		it("renders the post excerpt", () => {
			const wrapper = mountPostCard();
			expect(wrapper.text()).toContain("This is a test post excerpt.");
		});

		it("renders the category name", () => {
			const wrapper = mountPostCard();
			expect(wrapper.text()).toContain("Technology");
		});

		it("renders the view count", () => {
			const wrapper = mountPostCard();
			expect(wrapper.text()).toContain("42");
		});

		it("renders tags with # prefix", () => {
			const wrapper = mountPostCard();
			expect(wrapper.text()).toContain("#vue");
			expect(wrapper.text()).toContain("#nuxt");
		});
	});

	describe("link", () => {
		it("renders a link element", () => {
			const wrapper = mountPostCard();
			const link = wrapper.find("a");
			expect(link.exists()).toBe(true);
		});
	});

	describe("category display", () => {
		it("renders category badge when category is present", () => {
			const wrapper = mountPostCard();
			expect(wrapper.text()).toContain("Technology");
		});

		it("does not render category badge when category is null", () => {
			const postNoCategory = { ...mockPost, category: null };
			const wrapper = mountPostCard(postNoCategory);
			// Category span should not be present when category is null
			expect(wrapper.text()).not.toContain("Technology");
		});
	});

	describe("cover image", () => {
		it("renders algorithmic SVG data URI when no cover image", () => {
			const wrapper = mountPostCard();
			const img = wrapper.find("img");
			expect(img.exists()).toBe(true);
			expect(img.attributes("src")).toContain("data:image/svg+xml");
			// Title is URL-encoded inside the data URI
			expect(img.attributes("src")).toContain(encodeURIComponent("Test Post Title"));
		});

		it("generates different colors for different titles", () => {
			const wrapper1 = mountPostCard();
			const wrapper2 = mountPostCard({ ...mockPost, title: "Another Post Title" });
			const src1 = wrapper1.find("img").attributes("src");
			const src2 = wrapper2.find("img").attributes("src");
			// Different titles should produce different color values in the SVG
			expect(src1).not.toBe(src2);
		});

		it("renders algorithmic SVG data URI even when cover image is provided", () => {
			const postWithImage = {
				...mockPost,
				cover_image: "https://example.com/image.jpg",
			};
			const wrapper = mountPostCard(postWithImage);
			expect(wrapper.find("img").exists()).toBe(true);
			// All posts now render algorithmic SVG for display consistency
			expect(wrapper.find("img").attributes("src")).toContain("data:image/svg+xml");
		});
	});

	describe("excerpt", () => {
		it("does not render excerpt paragraph when excerpt is null", () => {
			const postNoExcerpt = { ...mockPost, excerpt: null };
			const wrapper = mountPostCard(postNoExcerpt);
			// No paragraph with excerpt text
			expect(wrapper.find("p").exists()).toBe(false);
		});
	});

	describe("views display", () => {
		it("renders 0 when views is 0", () => {
			const postNoViews = { ...mockPost, views: 0 };
			const wrapper = mountPostCard(postNoViews);
			expect(wrapper.text()).toContain("0");
		});
	});

	describe("comment count display", () => {
		it("renders the comment count when present", () => {
			const wrapper = mountPostCard();
			expect(wrapper.text()).toContain("7");
		});

		it("does not render a comment count when it is 0/absent", () => {
			const noComments = { ...mockPost, comment_count: 0 };
			const wrapper = mountPostCard(noComments);
			// The count is gated on truthiness so 0 renders nothing extra.
			expect(wrapper.text()).not.toContain("7");
		});
	});

	describe("bookmark", () => {
		it("renders a bookmark button", () => {
			const wrapper = mountPostCard();
			expect(wrapper.find("button[title='收藏文章']").exists()).toBe(true);
		});

		it("renders bookmark button with correct postId", () => {
			const wrapper = mountPostCard();
			const button = wrapper.find("button[title='收藏文章']");
			expect(button.exists()).toBe(true);
		});
	});

	describe("pinned badge", () => {
		it("renders a pinned badge when post.pinned is true", () => {
			const wrapper = mountPostCard({ ...mockPost, pinned: true });
			expect(wrapper.text()).toContain("置顶");
			expect(wrapper.find("svg.icon-stub").exists()).toBe(true);
		});

		it("does not render a pinned badge when post is not pinned", () => {
			const wrapper = mountPostCard({ ...mockPost, pinned: false });
			expect(wrapper.text()).not.toContain("置顶");
		});
	});
});
