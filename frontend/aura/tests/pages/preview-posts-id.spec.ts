/**
 * Author post-preview page tests (DEC-150, TASK-187).
 *
 * Renders a not-yet-published post's full reader view from the admin detail
 * when an admin token is present.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";

vi.stubGlobal("definePageMeta", vi.fn());

const { mockFetchPost, mockFetchCategories, mockFetchTags } = vi.hoisted(() => ({
	mockFetchPost: vi.fn(),
	mockFetchCategories: vi.fn(),
	mockFetchTags: vi.fn(),
}));

vi.mock("~~/api/admin/posts", () => ({
	getAdminPost: mockFetchPost,
}));
vi.mock("~~/api/admin/taxonomy", () => ({
	getAdminCategories: mockFetchCategories,
	getAdminTags: mockFetchTags,
}));
vi.mock("~~/composables/useSeo", () => ({ useSeo: vi.fn() }));
vi.mock("~~/composables/useLang", () => ({
	useLang: () => ({ t: (k: string) => k, locale: ref("zh") }),
}));

import PreviewPage from "../../app/pages/preview/posts/[id].vue";

const stubs = {
	Icon: { template: '<svg class="icon-stub" />' },
	NuxtLink: { template: '<a class="nuxt-link-stub"><slot/></a>' },
	MarkdownContent: {
		props: ["content"],
		template: '<div class="markdown-stub">{{ content }}</div>',
	},
};

async function mountPreview() {
	const wrapper = mount(PreviewPage as never, {
		global: { stubs },
	});
	await flushPromises();
	return wrapper;
}

const detail = {
	id: 5,
	title: "Draft Post",
	slug: "draft-post",
	content: "# Heading\n\nbody text",
	excerpt: "preview excerpt",
	published: false,
	pinned: false,
	publish_at: null,
	cover_image: null,
	category_id: 1,
	series_id: null,
	series_order: 0,
	series_title: null,
	series_slug: null,
	tag_ids: [2],
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:00:00Z",
};

function stubRoute(id = "5") {
	vi.stubGlobal("useRoute", () => ({ params: { id } }));
}

describe("Author preview page (TASK-187)", () => {
	it("renders a draft post's title, excerpt and content for an admin", async () => {
		window.localStorage.setItem("admin_token", "admin");
		stubRoute("5");
		mockFetchPost.mockResolvedValue(detail);
		// getAdminCategories/getAdminTags are the imperative $fetch seam — they
		// resolve to the raw arrays, not the useFetch AsyncData shape.
		mockFetchCategories.mockResolvedValue([{ id: 1, name: "AI" }]);
		mockFetchTags.mockResolvedValue([{ id: 2, name: "rust" }]);

		const wrapper = await mountPreview();
		expect(wrapper.text()).toContain("Draft Post");
		expect(wrapper.text()).toContain("preview excerpt");
		expect(wrapper.text()).toContain("Heading");
		expect(wrapper.text()).toContain("AI");
		expect(wrapper.text()).toContain("rust");
		window.localStorage.removeItem("admin_token");
	});

	it("does not fetch or render content without an admin token", async () => {
		window.localStorage.removeItem("admin_token");
		stubRoute("5");
		mockFetchPost.mockClear();

		const wrapper = await mountPreview();
		expect(mockFetchPost).not.toHaveBeenCalled();
		expect(wrapper.text()).not.toContain("Draft Post");
		window.localStorage.removeItem("admin_token");
	});
});
