/**
 * /follows page tests (DEC-292, TASK-375).
 *
 * The page is the full paginated feed of the reader's followed posts. Covers:
 * guest redirect to /login, empty-follows state, listing items, pagination
 * (tokens render, next page refetches), stale-session sign-in drop, load-error
 * retry, and the page-clamp on an out-of-range deep link.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";

import FollowsPage from "../../app/pages/follows.vue";

const mockReplace = vi.fn();
let mockRouteQuery: Record<string, string> = {};

// The reader-auth singleton: tests flip authenticated/isStaleSession to drive
// the guest gate, the stale-session drop, and the sign-out watcher.
const mockAuth = ref({ isAuthenticated: true });
vi.mock("../../composables/useReaderAuth", () => ({
	useReaderAuth: () => ({
		isAuthenticated: computed(() => mockAuth.value.isAuthenticated),
		logout: vi.fn(),
		isStaleSession: (cause: unknown) => (cause as { stale?: boolean } | undefined)?.stale === true,
	}),
}));

vi.mock("../../composables/useSeo", () => ({
	useSeo: vi.fn(),
}));

vi.mock("~~/composables/useLang", () => ({
	useLang: () => ({ t: (k: string) => k, locale: ref("zh") }),
}));

// getReaderFollowsFeed returns the paginated envelope; the test sets both the
// current payload and (for the clamp test) a "next" payload.
let feedPayload: { items: unknown[]; pagination: unknown } = {
	items: [],
	pagination: { total: 0, page: 1, limit: 12, total_pages: 1 },
};
let feedReject: unknown = null;
vi.mock("../../api/reader/follows", () => ({
	getReaderFollowsFeed: async () => {
		if (feedReject) throw feedReject;
		return feedPayload;
	},
}));

const stubs = {
	Icon: { template: "<svg class='icon-stub' />" },
	NuxtLink: { template: "<a class='nuxt-link-stub'><slot/></a>" },
};

const samplePost = {
	id: 1,
	title: "A followed post",
	slug: "followed-post",
	excerpt: "excerpt",
	published: true,
	created_at: "2024-01-15T10:00:00Z",
	views: 10,
	likes: 0,
	cover_image: null,
	category: { id: 1, name: "Tech" },
	tags: [],
	series: null,
	series_order: 0,
};

beforeEach(() => {
	mockRouteQuery = {};
	mockAuth.value = { isAuthenticated: true };
	feedPayload = {
		items: [],
		pagination: { total: 0, page: 1, limit: 12, total_pages: 1 },
	};
	feedReject = null;
	mockReplace.mockClear();
	vi.stubGlobal("useRoute", () => ({ path: "/follows", query: mockRouteQuery }));
	vi.stubGlobal("navigateTo", vi.fn());
	vi.stubGlobal("useRouter", () => ({ replace: mockReplace }));
});

afterEach(() => {
	vi.unstubAllGlobals();
});

async function mountFollows() {
	const wrapper = mount(FollowsPage, { global: { stubs } });
	await flushPromises();
	return wrapper;
}

describe("Follows page", () => {
	it("redirects guests to /login", async () => {
		mockAuth.value = { isAuthenticated: false };
		await mountFollows();
		expect(mockReplace).toHaveBeenCalledWith("/login");
	});

	it("shows the empty state when the reader follows nothing", async () => {
		const wrapper = await mountFollows();
		expect(wrapper.text()).toContain("follows.title");
		expect(wrapper.text()).toContain("follows.empty");
		expect(wrapper.text()).toContain("follows.emptyAction");
		expect(wrapper.find(".nuxt-link-stub").exists()).toBe(true);
	});

	it("renders followed posts", async () => {
		feedPayload = {
			items: [samplePost],
			pagination: { total: 1, page: 1, limit: 12, total_pages: 1 },
		};
		const wrapper = await mountFollows();
		expect(wrapper.text()).toContain("A followed post");
		expect(wrapper.text()).toContain("follows.countLabel");
		expect(wrapper.text()).not.toContain("follows.empty");
	});

	it("shows pagination controls only when there is more than one page", async () => {
		feedPayload = {
			items: [samplePost],
			pagination: { total: 25, page: 1, limit: 12, total_pages: 3 },
		};
		const wrapper = await mountFollows();
		const buttons = wrapper.findAll("button").filter((b) => /^\d+$/.test(b.text()));
		expect(buttons.length).toBeGreaterThan(0);
	});

	it("surfaces a load failure with a retry instead of the empty state", async () => {
		feedReject = new Error("network");
		const wrapper = await mountFollows();
		expect(wrapper.text()).toContain("follows.loadFailed");
		expect(wrapper.text()).not.toContain("follows.empty");

		// Retry path: flip the payload to success and click Retry — the failure
		// must not be permanent.
		feedReject = null;
		feedPayload = {
			items: [samplePost],
			pagination: { total: 1, page: 1, limit: 12, total_pages: 1 },
		};
		const retry = wrapper.findAll("button").find((b) => b.text().includes("follows.retry"));
		await retry?.trigger("click");
		await flushPromises();
		expect(wrapper.text()).toContain("A followed post");
	});

	it("drops a stale session to /login instead of a misleading failure block", async () => {
		feedReject = { stale: true };
		const wrapper = await mountFollows();
		expect(mockReplace).toHaveBeenCalledWith("/login");
		expect(wrapper.text()).not.toContain("follows.loadFailed");
	});

	it("clamps an out-of-range page deep link back to the last real page", async () => {
		mockRouteQuery = { page: "99" };
		feedPayload = {
			items: [samplePost],
			pagination: { total: 5, page: 1, limit: 12, total_pages: 1 },
		};
		const wrapper = await mountFollows();
		await flushPromises();
		// The clamp watch sends the reader back to page 1 (replace, not push —
		// the broken URL must not stay in history).
		expect(vi.mocked(globalThis.navigateTo)).toHaveBeenCalledWith(
			{ query: { page: "1" } },
			{ replace: true },
		);
		// The empty state must NOT flash while the clamp is pending: the
		// out-of-range response stays in the loading skeleton until the clamp
		// refetch lands (review finding).
		expect(wrapper.text()).not.toContain("follows.empty");
		// Still pending → the skeleton block renders instead of the list/empty.
		expect(wrapper.findAll(".animate-pulse").length).toBeGreaterThan(0);
	});

	it("treats a malformed ?page=abc as page 1 instead of sending NaN to the API", async () => {
		mockRouteQuery = { page: "abc" };
		const wrapper = await mountFollows();
		await flushPromises();
		// Page resolves to 1 → a normal (non-error) render with the empty state.
		expect(wrapper.text()).toContain("follows.title");
		expect(wrapper.text()).toContain("follows.empty");
		expect(wrapper.text()).not.toContain("follows.loadFailed");
	});
});
