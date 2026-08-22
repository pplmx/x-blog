/**
 * Print / PDF view tests (DEC-112, TASK-168).
 *
 * Verifies the /posts/[slug]/print route renders the article title, excerpt,
 * reading time, and sanitized markdown content (via MarkdownContent), exposes a
 * back-to-article link and a Print/PDF button (window.print), and shows the
 * localized not-found state when the post cannot be loaded.
 *
 * Same mocking strategy as slug.spec.ts: stub useRuntimeConfig/useFetch/useRoute
 * and useHead, and stub NuxtLink/Icon/MarkdownContent so no mermaid/katex/DOMPurify
 * is loaded in the unit environment.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const mockPost = {
	id: 1,
	title: "Printable Article",
	slug: "printable-article",
	excerpt: "A clean, archive-friendly excerpt.",
	content: "# Introduction\n\nThis is the post content.",
	published: true,
	created_at: "2024-01-15T10:30:00Z",
	updated_at: "2024-01-15T10:30:00Z",
	views: 1234,
	likes: 56,
	cover_image: null,
	category: { id: 1, name: "Tech" },
	tags: [],
};

async function mountPrintPage({
	post = mockPost,
	pending = false,
	error = null,
	slug = "printable-article",
}: {
	post?: typeof mockPost | null;
	pending?: boolean;
	error?: { message: string } | null;
	slug?: string;
} = {}) {
	vi.stubGlobal("useRuntimeConfig", () => ({
		public: { apiUrl: "http://localhost:18888" },
	}));

	vi.stubGlobal("useHead", vi.fn());

	vi.stubGlobal("useRoute", () => ({
		params: { slug },
		query: {},
	}));

	vi.stubGlobal("navigateTo", vi.fn());

	vi.stubGlobal(
		"useFetch",
		vi.fn((url: string, _options?: Record<string, unknown>) => {
			if (typeof url === "function") url = url();
			return {
				data: ref(post),
				pending: ref(pending),
				error: ref(error),
				refresh: vi.fn(),
			};
		}),
	);

	const { default: PrintPage } = await import("@/pages/posts/[slug]/print.vue");

	const SuspenseWrapper: any = {
		components: { PrintPage },
		template:
			"<Suspense>" +
			"<template #default><PrintPage /></template>" +
			"<template #fallback>Loading...</template>" +
			"</Suspense>",
	};

	const wrapper = mount(SuspenseWrapper, {
		global: {
			stubs: {
				NuxtLink: {
					template: '<a :href="to"><slot/></a>',
					props: ["to"],
				},
				Icon: {
					template: '<svg class="iconstub" :data-icon="icon"></svg>',
					props: ["icon"],
				},
				MarkdownContent: {
					template: '<div class="markdown-content"><div v-html="content"></div></div>',
					props: ["content"],
				},
			},
		},
	});

	await flushPromises();
	return wrapper;
}

describe("Print / PDF view", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("renders the post title", async () => {
		const wrapper = await mountPrintPage();
		expect(wrapper.text()).toContain("Printable Article");
	});

	it("renders the post excerpt", async () => {
		const wrapper = await mountPrintPage();
		expect(wrapper.text()).toContain("A clean, archive-friendly excerpt.");
	});

	it("renders the sanitized markdown content via MarkdownContent", async () => {
		const wrapper = await mountPrintPage();
		const content = wrapper.find(".markdown-content");
		expect(content.exists()).toBe(true);
		expect(content.text()).toContain("Introduction");
	});

	it("shows the CJK-aware reading time", async () => {
		const wrapper = await mountPrintPage();
		// zh default locale -> "X 分钟"
		expect(wrapper.text()).toMatch(/\d+ 分钟/);
	});

	it("renders a back-to-article link to /posts/[slug]", async () => {
		const wrapper = await mountPrintPage();
		const back = wrapper.find("a[href='/posts/printable-article']");
		expect(back.exists()).toBe(true);
		expect(back.text()).toContain("返回文章");
	});

	it("renders a Print/PDF button that calls window.print", async () => {
		const printSpy = vi.fn();
		vi.stubGlobal("print", printSpy);
		Object.defineProperty(window, "print", {
			value: printSpy,
			writable: true,
		});
		const wrapper = await mountPrintPage();
		const button = wrapper.find("button");
		expect(button.exists()).toBe(true);
		expect(button.text()).toContain("打印 / PDF");
		await button.trigger("click");
		expect(printSpy).toHaveBeenCalled();
	});

	it("renders not-found message when the post is null", async () => {
		const wrapper = await mountPrintPage({ post: null });
		expect(wrapper.text()).toContain("文章不存在");
	});

	it("renders not-found message when the fetch fails", async () => {
		const wrapper = await mountPrintPage({ error: { message: "network down" } });
		expect(wrapper.text()).toContain("文章不存在");
	});
});
