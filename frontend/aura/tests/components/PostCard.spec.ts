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
		it("renders gradient placeholder when no cover image", () => {
			const wrapper = mountPostCard();
			expect(wrapper.find(".bg-gradient-to-br").exists()).toBe(true);
		});

		it("renders img element when cover image is provided", () => {
			const postWithImage = {
				...mockPost,
				cover_image: "https://example.com/image.jpg",
			};
			const wrapper = mountPostCard(postWithImage);
			expect(wrapper.find("img").exists()).toBe(true);
			expect(wrapper.find("img").attributes("src")).toBe("https://example.com/image.jpg");
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
});
