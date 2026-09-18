/**
 * Discussion feed page tests (round 367, DEC-407)
 *
 * A public page listing the newest approved comments across the site, each
 * card deep-linking ONTO the exact comment (#comment-{id}, DEC-321). Tests
 * the rendering states: loading, error, empty, feed cards (content +
 * commenter + post brief + deep link), and pagination.
 *
 * Mocks Nuxt composables (useFetch, useRuntimeConfig, useRoute, navigateTo)
 * and stubs NuxtLink and Icon components (same pattern as archive.spec.ts).
 * The page uses `await useDiscussionFeed(...)` in <script setup>, so it is
 * wrapped in a <Suspense> boundary.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reactive, ref } from "vue";

// Blocked-reader suppression (round 386, DEC-437): stub the composable so the
// feed-filter test can inject a blocked reader id and observe the card vanish.
const mockBlockedSet = ref(new Set<number>());
vi.mock("~~/composables/useBlockedReaderIds", () => ({
	useBlockedReaderIds: () => ({
		blockedReaderIds: mockBlockedSet,
		loadBlockedReaderIds: vi.fn(),
	}),
}));

const mockFeed = {
	items: [
		{
			id: 11,
			nickname: "Commenter One",
			content: "this is the deepest take yet",
			likes: 3,
			created_at: "2024-03-01T09:00:00Z",
			reader: null,
			post: { id: 9, title: "Searchable Post", slug: "searchable-post" },
		},
		{
			id: 12,
			nickname: "x",
			content: "reader-attributed thought",
			likes: 1,
			created_at: "2024-02-25T14:30:00Z",
			reader: { id: 5, display_name: "Reader Five", avatar_url: null },
			post: { id: 9, title: "Searchable Post", slug: "searchable-post" },
		},
	],
	pagination: {
		total: 22,
		page: 1,
		limit: 20,
		total_pages: 2,
	},
};

const mockEmptyFeed = {
	items: [],
	pagination: { total: 0, page: 1, limit: 20, total_pages: 0 },
};

async function mountDiscussionPage({
	feed = mockFeed,
	pending = false,
	error = null,
	feedRef = undefined,
	routeQuery = {},
}: {
	feed?: typeof mockFeed | null;
	pending?: boolean;
	error?: unknown;
	feedRef?: { value: typeof mockFeed | null };
	routeQuery?: Record<string, string>;
} = {}) {
	vi.stubGlobal("useRuntimeConfig", () => ({
		public: {
			apiUrl: "http://localhost:18888",
		},
	}));

	vi.stubGlobal("useRoute", () => reactive({ query: routeQuery }));

	vi.stubGlobal("navigateTo", vi.fn());

	vi.stubGlobal("useHead", vi.fn());

	// The page uses `computed`/`watch` without importing them (Nuxt auto-imports)
	vi.stubGlobal("computed", (await import("vue")).computed);
	vi.stubGlobal("watch", (await import("vue")).watch);

	vi.stubGlobal(
		"useFetch",
		vi.fn((url: unknown) => {
			return {
				data: (feedRef ?? ref(feed)) as unknown,
				pending: ref(pending),
				error: ref(error),
				refresh: vi.fn(),
			};
		}),
	);

	const { default: DiscussionPage } = await import("../../app/pages/discussion.vue");

	const SuspenseWrapper: any = {
		components: { DiscussionPage },
		template:
			"<Suspense>" +
			"<template #default><DiscussionPage /></template>" +
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
			},
		},
	});

	await flushPromises();
	return wrapper;
}

describe("Discussion feed page (round 367, DEC-407)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("renders the feed header", async () => {
		const wrapper = await mountDiscussionPage();
		expect(wrapper.text()).toContain("最新讨论");
	});

	it("offers a subscribe link to the discussion RSS feed (round 368)", async () => {
		const wrapper = await mountDiscussionPage();
		expect(wrapper.text()).toContain("订阅讨论 RSS");
		const rss = wrapper.find('a[href="/rss/comments.xml"]');
		expect(rss.exists()).toBe(true);
		expect(rss.attributes("type")).toBe("application/rss+xml");
	});

	it("renders comment cards with commenter, post brief, and a deep link onto the comment", async () => {
		const wrapper = await mountDiscussionPage();
		// First card: guest commenter (nickname), its content, and the post brief.
		expect(wrapper.text()).toContain("this is the deepest take yet");
		expect(wrapper.text()).toContain("Commenter One");
		expect(wrapper.text()).toContain("Searchable Post");
		// Second card: reader-attributed commenter uses the display name.
		expect(wrapper.text()).toContain("Reader Five");
		// The card deep-links ONTO the comment (DEC-321), not the post headline.
		const link = wrapper.find('a[href="/posts/searchable-post#comment-11"]');
		expect(link.exists()).toBe(true);
	});

	it("renders the empty state when there is no discussion yet", async () => {
		const wrapper = await mountDiscussionPage({ feed: mockEmptyFeed });
		expect(wrapper.text()).toContain("还没有公开的讨论");
	});

	it("renders a friendly error and a retry when the feed fails to load", async () => {
		const wrapper = await mountDiscussionPage({ feed: null, error: { message: "boom" } });
		expect(wrapper.text()).toContain("讨论加载失败");
		expect(wrapper.text()).not.toContain("boom");
	});

	it("renders pagination buttons when the feed has multiple pages", async () => {
		const wrapper = await mountDiscussionPage(); // total_pages 2
		const buttons = wrapper.findAll("button");
		expect(buttons.some((b) => b.text().trim() === "2")).toBe(true);
	});

	it("navigates with the page param when a page is clicked", async () => {
		const wrapper = await mountDiscussionPage(); // total_pages 2, page 1
		const navigateSpy = vi.fn();
		vi.stubGlobal("navigateTo", navigateSpy);
		const page2 = wrapper.findAll("button").find((b) => b.text().trim() === "2");
		expect(page2).toBeDefined();
		await page2?.trigger("click");
		await flushPromises();
		// Page 1 drops the param; page 2 sends it.
		expect(navigateSpy).toHaveBeenCalledWith({ query: { page: "2" } });
	});

	it("hides blocked readers' cards and keeps the rest (round 386, DEC-437)", async () => {
		mockBlockedSet.value = new Set([5]); // Reader Five (feed item id 12)
		const wrapper = await mountDiscussionPage();
		// The blocked reader's card is gone; the anonymous guest card remains.
		expect(wrapper.text()).not.toContain("Reader Five");
		expect(wrapper.text()).toContain("this is the deepest take yet");
	});

	it("shows every card when nothing is blocked", async () => {
		mockBlockedSet.value = new Set();
		const wrapper = await mountDiscussionPage();
		expect(wrapper.text()).toContain("Reader Five");
		expect(wrapper.text()).toContain("this is the deepest take yet");
	});
});
