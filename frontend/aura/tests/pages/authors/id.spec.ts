/**
 * Author archive page (/authors/[id]) tests.
 *
 * Covers rendering states: loading, populated (pen-name header + published
 * posts), an empty-but-public author (title still shows the name), a 404 for
 * unknown/never-public authors, an invalid (non-numeric) id that never hits
 * the API, and a generic load failure.
 *
 * Mocks Nuxt composables (useFetch, useRuntimeConfig, useRoute) and stubs
 * NuxtLink and Icon. The page uses `await useAuthorPosts(...)` in <script
 * setup>, so it is wrapped in a <Suspense> boundary (same pattern as the
 * series/[slug] spec).
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";

const archiveWithPosts = {
	items: [
		{
			id: 21,
			title: "Routed Post",
			slug: "routed-post",
			excerpt: "Who wrote this?",
			published: true,
			created_at: "2024-06-01T10:00:00Z",
			views: 100,
			cover_image: null,
			category: { id: 1, name: "Tech" },
			tags: [],
			series: null,
			series_order: 0,
			author: { id: 7, display_name: "Riki" },
		},
	],
	pagination: { total: 1, page: 1, limit: 10, total_pages: 1 },
	author: { id: 7, display_name: "Riki" },
};

const emptyArchive = {
	items: [],
	pagination: { total: 0, page: 1, limit: 10, total_pages: 0 },
	author: { id: 7, display_name: "Riki" },
};

async function mountAuthorsPage({
	authorId = "7",
	archive = archiveWithPosts,
	pending = false,
	error = null,
}: {
	authorId?: string;
	archive?: typeof archiveWithPosts | null;
	pending?: boolean;
	error?: { message: string; statusCode?: number } | null;
} = {}) {
	vi.stubGlobal("useRuntimeConfig", () => ({
		public: { apiUrl: "http://localhost:18888" },
	}));
	vi.stubGlobal("useHead", vi.fn());
	vi.stubGlobal("useRoute", () => ({
		params: { id: authorId },
		query: {},
	}));
	vi.stubGlobal("navigateTo", vi.fn());
	vi.stubGlobal("computed", computed);
	vi.stubGlobal(
		"useFetch",
		vi.fn((url: string | (() => string | null) | { value: string }) => {
			const urlStr =
				typeof url === "function" ? url() : typeof url === "string" ? url : (url.value ?? "");
			if (typeof urlStr === "string" && urlStr.includes("/api/authors/")) {
				return {
					data: ref(archive),
					pending: ref(pending),
					error: ref(error),
					refresh: vi.fn(),
				};
			}
			return {
				data: ref(null),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			};
		}),
	);

	const { default: AuthorsPage } = await import("@/pages/authors/[id].vue");

	const SuspenseWrapper = {
		components: { AuthorsPage },
		template:
			"<Suspense>" +
			"<template #default><AuthorsPage /></template>" +
			"<template #fallback>Loading...</template>" +
			"</Suspense>",
	};

	const wrapper = mount(SuspenseWrapper, {
		global: {
			stubs: {
				NuxtLink: { template: '<a :href="to"><slot/></a>', props: ["to"] },
				Icon: { template: '<svg class="iconstub" :data-icon="icon"></svg>', props: ["icon"] },
				PostCard: {
					template: '<article class="postcard-stub">{{ post.title }}</article>',
					props: ["post"],
				},
			},
		},
	});

	await flushPromises();
	return wrapper;
}

describe("Author archive page (/authors/[id])", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("renders the pen-name header and the author's posts", async () => {
		const wrapper = await mountAuthorsPage();
		expect(wrapper.text()).toContain("Riki 的文章");
		expect(wrapper.text()).toContain("Routed Post");
	});

	it("renders a paginated grid's posts with an author page of posts", async () => {
		const wrapper = await mountAuthorsPage({
			archive: {
				items: [
					{ ...archiveWithPosts.items[0] },
					{
						...archiveWithPosts.items[0],
						id: 22,
						title: "Second Post",
						slug: "second-post",
					},
				],
				pagination: { total: 2, page: 1, limit: 10, total_pages: 1 },
				author: { id: 7, display_name: "Riki" },
			},
		});
		expect(wrapper.findAll(".postcard-stub").length).toBe(2);
	});

	it("titles an empty-but-public author by pen name (envelope, not posts)", async () => {
		const wrapper = await mountAuthorsPage({ archive: emptyArchive });
		expect(wrapper.text()).toContain("Riki 的文章");
		expect(wrapper.text()).toContain("这位作者还没有发布任何文章");
	});

	it("renders the not-found state for a 404 (unknown / never-public author)", async () => {
		const wrapper = await mountAuthorsPage({
			archive: null,
			error: { message: "Author not found", statusCode: 404 },
		});
		expect(wrapper.text()).toContain("作者不存在");
	});

	it("renders the not-found state for a non-numeric id without fetching", async () => {
		const wrapper = await mountAuthorsPage({
			authorId: "not-a-number",
			archive: null,
		});
		expect(wrapper.text()).toContain("作者不存在");
	});

	it("surfaces a load failure with a retry instead of the empty state", async () => {
		const wrapper = await mountAuthorsPage({
			error: { message: "boom", statusCode: 500 },
		});
		expect(wrapper.text()).toContain("加载失败");
	});
});
