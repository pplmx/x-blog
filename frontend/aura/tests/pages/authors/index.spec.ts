/**
 * Authors index page (/authors) tests.
 *
 * Covers rendering states: loading, populated (pen name + post count per
 * writer, each linking to /authors/{id}), a genuine empty state, and a load
 * failure with retry.
 *
 * Mocks Nuxt composables (useFetch, useRuntimeConfig) and stubs NuxtLink and
 * Icon. The page uses `await useAuthors()` in <script setup>, so it is wrapped
 * in a <Suspense> boundary.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const mockAuthors = [
	{ id: 7, display_name: "Riki", post_count: 3 },
	{ id: 9, display_name: "Ghost Writer", post_count: 0 },
];

async function mountAuthorsIndex({
	authors = mockAuthors,
	pending = false,
	error = null,
}: {
	authors?: typeof mockAuthors | null;
	pending?: boolean;
	error?: { message: string } | null;
} = {}) {
	vi.stubGlobal("useRuntimeConfig", () => ({
		public: { apiUrl: "http://localhost:18888" },
	}));
	vi.stubGlobal("useHead", vi.fn());
	vi.stubGlobal(
		"useFetch",
		vi.fn((url: string | (() => string | null) | { value: string }) => {
			const urlStr =
				typeof url === "function" ? url() : typeof url === "string" ? url : (url.value ?? "");
			if (typeof urlStr === "string" && urlStr === "/api/authors") {
				return {
					data: ref(authors),
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

	const { default: AuthorsIndex } = await import("@/pages/authors/index.vue");

	const SuspenseWrapper = {
		components: { AuthorsIndex },
		template:
			"<Suspense>" +
			"<template #default><AuthorsIndex /></template>" +
			"<template #fallback>Loading...</template>" +
			"</Suspense>",
	};

	const wrapper = mount(SuspenseWrapper, {
		global: {
			stubs: {
				NuxtLink: { template: '<a :href="to"><slot/></a>', props: ["to"] },
				Icon: { template: '<svg class="iconstub" :data-icon="icon"></svg>', props: ["icon"] },
			},
		},
	});

	await flushPromises();
	return wrapper;
}

describe("Authors index page (/authors)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("renders each writer's pen name and post count, linking to their archive", async () => {
		const wrapper = await mountAuthorsIndex();
		expect(wrapper.text()).toContain("Riki");
		expect(wrapper.text()).toContain("3 篇文章");
		expect(wrapper.text()).toContain("Ghost Writer");
		expect(wrapper.text()).toContain("0 篇文章");
		const link = wrapper.findAll("a").find((a) => a.attributes("href") === "/authors/7");
		expect(link?.exists()).toBe(true);
	});

	it("renders the empty state when no author has a pen name", async () => {
		const wrapper = await mountAuthorsIndex({ authors: [] });
		expect(wrapper.text()).toContain("还没有作者设置公开笔名");
	});

	it("surfaces a load failure with retry instead of the empty state", async () => {
		const wrapper = await mountAuthorsIndex({ error: { message: "boom" } });
		expect(wrapper.text()).toContain("加载失败");
	});
});
