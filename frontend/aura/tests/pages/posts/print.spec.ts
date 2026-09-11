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
	headMock,
}: {
	post?: typeof mockPost | null;
	pending?: boolean;
	error?: { message: string } | null;
	slug?: string;
	headMock?: ReturnType<typeof vi.fn>;
} = {}) {
	vi.stubGlobal("useRuntimeConfig", () => ({
		public: { apiUrl: "http://localhost:18888" },
	}));

	vi.stubGlobal("useHead", headMock ?? vi.fn());

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

/** Mount with a captured useHead mock so a test can inspect the reactive title. */
async function mountPrintPageWithHead(
	opts: { post?: typeof mockPost | null; error?: { message: string } | null } = {},
) {
	const headMock = vi.fn();
	const wrapper = await mountPrintPage({ ...opts, headMock });
	return { wrapper, headMock };
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

	it("a missing/deleted print post offers a way home instead of a dead end (round 299)", async () => {
		const wrapper = await mountPrintPage({ post: null });
		// Before the round-299 fix this was a bare "not found" line with no path
		// onward — a stale share/cached print link to a removed post stranded the
		// reader (the article page always offered Home).
		expect(wrapper.find('a[href="/"]').exists()).toBe(true);
		expect(wrapper.text()).toContain("返回首页");
	});

	it("uses a reactive useHead title so SPA navigation between print slugs updates the tab (round 299)", async () => {
		// The title is a getter closing over the post ref (not a one-shot
		// evaluated value): SPA navigation between print slugs keeps this
		// component mounted, and a static value would leave the previous post's
		// title on the tab.
		const { headMock } = await mountPrintPageWithHead({ post: mockPost });
		expect(headMock).toHaveBeenCalled();
		const title = headMock.mock.calls.at(-1)?.[0].title;
		expect(title).toBeDefined();
		expect(typeof title).toBe("function");
		expect(title()).toContain("Printable Article");
		expect(title()).toContain("打印 / PDF");
	});
});
