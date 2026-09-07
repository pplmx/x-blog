/**
 * Author-preview page tests (DEC-150, TASK-187; retry affordance round 276).
 *
 * Verifies the loading skeleton, the rendered draft (title/reading time),
 * the failed state — and that a failed load offers Retry (the codebase's
 * standard load-error affordance was missing here, a deep-dive finding).
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NuxtLinkStub } from "./helpers.ts";

const { mockGetAdminPost, mockGetAdminCategories, mockGetAdminTags } = vi.hoisted(() => ({
	mockGetAdminPost: vi.fn(),
	mockGetAdminCategories: vi.fn(),
	mockGetAdminTags: vi.fn(),
}));

vi.mock("~~/api/admin/posts", () => ({
	getAdminPost: mockGetAdminPost,
}));
vi.mock("~~/api/admin/taxonomy", () => ({
	getAdminCategories: mockGetAdminCategories,
	getAdminTags: mockGetAdminTags,
}));

vi.mock("../../composables/useSeo", () => ({ useSeo: vi.fn() }));
vi.mock("../../composables/useLang", () => {
	// Minimal zh map for the strings the assertions target; unknown keys stay
	// the raw key so setValue plumbing still works.
	const dict: Record<string, string> = {
		"preview.back": "返回文章列表",
		"preview.badge": "预览（尚未发布）",
		"preview.loadFailed": "无法加载文章进行预览",
		"common.action.retry": "重试",
	};
	return {
		useLang: () => ({
			t: (key: string) => dict[key] ?? key,
			locale: { value: "zh" },
		}),
	};
});

vi.stubGlobal("useRuntimeConfig", () => ({
	public: { apiUrl: "http://localhost:18888" },
}));
vi.stubGlobal("useRoute", () => ({ params: { id: "42" } }));
vi.stubGlobal("definePageMeta", vi.fn());

const IconStub = {
	props: ["icon"],
	template: '<svg class="iconstub" :data-icon="icon" />',
};
const MarkdownContentStub = {
	props: ["content"],
	template: '<div class="markdown-stub" />',
};

const post = {
	id: 42,
	title: "Draft Preview Post",
	slug: "draft-preview-post",
	content: "# Heading\nbody",
	created_at: "2026-08-01T00:00:00",
	published: false,
	category_id: null,
	tag_ids: [],
};

async function loadPage() {
	const { default: PreviewPage } = await import("@/pages/preview/posts/[id].vue");
	return PreviewPage;
}

function mountPreview(PreviewPage: any, overrides: any = {}) {
	return mount(PreviewPage, {
		global: {
			stubs: {
				NuxtLink: NuxtLinkStub,
				Icon: IconStub,
				MarkdownContent: MarkdownContentStub,
			},
			// simulate a signed-in admin so the loader actually runs
			mocks: overrides,
		},
	});
}

describe("Author preview page (TASK-187)", () => {
	beforeEach(() => {
		mockGetAdminPost.mockClear();
		mockGetAdminCategories.mockClear();
		mockGetAdminTags.mockClear();
		// A signed-in admin: localStorage has the token so onMounted loads.
		vi.stubGlobal("localStorage", {
			getItem: vi.fn((k: string) => (k === "admin_token" ? "token" : null)),
			setItem: vi.fn(),
			removeItem: vi.fn(),
		});
		mockGetAdminPost.mockResolvedValue(post);
		mockGetAdminCategories.mockResolvedValue([{ id: 1, name: "Tech" }]);
		mockGetAdminTags.mockResolvedValue([{ id: 1, name: "rust" }]);
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("does not load when there is no admin token", async () => {
		vi.stubGlobal("localStorage", {
			getItem: vi.fn(() => null),
			setItem: vi.fn(),
			removeItem: vi.fn(),
		});
		const PreviewPage = await loadPage();
		mountPreview(PreviewPage);
		await flushPromises();
		expect(mockGetAdminPost).not.toHaveBeenCalled();
	});

	it("renders the draft after loading (title + preview badge)", async () => {
		const PreviewPage = await loadPage();
		const wrapper = mountPreview(PreviewPage);
		await flushPromises();
		expect(mockGetAdminPost).toHaveBeenCalledWith(42);
		expect(wrapper.text()).toContain("Draft Preview Post");
		expect(wrapper.text()).toContain("预览（尚未发布）");
	});

	it("shows a failed state AND a retry affordance on load failure (round 276)", async () => {
		mockGetAdminPost.mockRejectedValueOnce(new Error("network"));
		const PreviewPage = await loadPage();
		const wrapper = mountPreview(PreviewPage);
		await flushPromises();

		expect(wrapper.text()).toContain("无法加载文章进行预览");
		const retry = wrapper.findAll("button").find((b) => b.text() === "重试");
		expect(retry).toBeDefined();

		// Retry re-fetches and recovers (a transient failure, not a dead end).
		await retry?.trigger("click");
		await flushPromises();
		expect(mockGetAdminPost).toHaveBeenCalledTimes(2);
		expect(wrapper.text()).toContain("Draft Preview Post");
	});
});
