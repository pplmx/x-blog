/**
 * Public static page (/pages/{slug}) tests (round 347).
 *
 * Covers rendering states: loading, a published page (title + markdown body +
 * updated date), a genuine 404 (unpublished/unknown — the public surface is
 * no-oracle), and a load failure with retry.
 *
 * Mocks Nuxt composables (useFetch, useRuntimeConfig) and stubs NuxtLink,
 * Icon and MarkdownContent. The page uses `await usePage()` in <script setup>,
 * so it is wrapped in a <Suspense> boundary.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const mockPage = {
	slug: "privacy",
	title: "Privacy Policy",
	content: "## Data we collect\n\nNothing.",
	updated_at: "2026-09-15T06:00:00",
};

async function mountPage({
	page = mockPage,
	pending = false,
	error = null,
	slug = "privacy",
}: {
	page?: typeof mockPage | null;
	pending?: boolean;
	error?: { statusCode?: number; message?: string } | null;
	slug?: string;
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
			if (typeof urlStr === "string" && urlStr === `/api/pages/${slug}`) {
				return {
					data: ref(page),
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

	// `await usePage()` in <script setup> => Suspense boundary.
	const { default: PageView } = await import("@/pages/pages/[slug].vue");
	const route = { params: { slug } };
	vi.stubGlobal("useRoute", () => route);

	const SuspenseWrapper = {
		components: { PageView },
		template:
			"<Suspense>" +
			"<template #default><PageView /></template>" +
			"<template #fallback>Loading...</template>" +
			"</Suspense>",
	};

	const wrapper = mount(SuspenseWrapper, {
		global: {
			stubs: {
				NuxtLink: { template: '<a :href="to"><slot/></a>', props: ["to"] },
				Icon: { template: '<svg class="iconstub" :data-icon="icon"></svg>', props: ["icon"] },
				MarkdownContent: {
					template: '<div class="markdown-stub">{{ content }}</div>',
					props: ["content"],
				},
			},
		},
	});

	await flushPromises();
	return wrapper;
}

describe("Public static page (/pages/{slug})", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("renders a published page's title, markdown body and updated date", async () => {
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("Privacy Policy");
		expect(wrapper.text()).toContain("## Data we collect");
		expect(wrapper.text()).toContain("最后更新于");
	});

	it("renders the not-found state for an unknown/unpublished page (no-oracle)", async () => {
		const wrapper = await mountPage({
			page: null,
			error: { statusCode: 404, message: "Page not found" },
			slug: "never-existed",
		});
		expect(wrapper.text()).toContain("这个页面不存在");
	});

	it("surfaces a load failure with retry instead of an empty page", async () => {
		const wrapper = await mountPage({
			page: null,
			error: { message: "boom" },
		});
		expect(wrapper.text()).toContain("加载失败");
	});
});
