/**
 * /liked page tests (round 359 journey + DEC-413/TASK-432 recall search).
 *
 * Guest redirect, empty state, listing liked posts, and the recall search:
 * debounced typing refetches with the q term, a search from a deep page resets
 * to page 1, a no-match term shows the search-aware empty state with a
 * clear-search reset, and the box's x button clears and refetches.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";

import LikedPage from "../../app/pages/liked.vue";

const mockReplace = vi.fn();
let mockRouteQuery: Record<string, string> = {};

// The reader-auth singleton: tests flip isAuthenticated to drive the guest gate
// and the stale-session drop.
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

let mockUnlikeReject: unknown = null;
// unlike() now reports whether the cloud DELETE landed; the page only drops a
// card on a persisted removal, so the happy-path mock resolves true.
let mockUnlikeResult: unknown = true;
const mockUnlike = vi.fn(async () => {
	if (mockUnlikeReject) throw mockUnlikeReject;
	return mockUnlikeResult;
});
vi.mock("../../composables/useLikeSync", () => ({
	useLikeSync: () => ({
		likeSyncIssue: ref<string | null>(null),
		clearLikeSyncIssue: vi.fn(),
		mergeLocalToCloud: async () => {
			/* no-op in tests */
		},
		unlike: mockUnlike,
	}),
}));

// getReaderLikes returns the paginated envelope; tests flip the payload and
// record calls to assert the q/limit/page arguments.
let likesPayload: { items: unknown[]; pagination: unknown } = {
	items: [],
	pagination: { total: 0, page: 1, limit: 12, total_pages: 1 },
};
let likesReject: unknown = null;
const fetchLikes = vi.fn(async () => {
	if (likesReject) throw likesReject;
	return likesPayload;
});
vi.mock("../../api/reader/likes", () => ({
	getReaderLikes: (...args: unknown[]) => fetchLikes(...args),
}));

const stubs = {
	Icon: { template: "<svg class='icon-stub' />" },
	NuxtLink: { template: "<a class='nuxt-link-stub'><slot/></a>" },
};

const samplePost = {
	id: 1,
	title: "A liked post",
	slug: "liked-post",
	excerpt: "excerpt",
	published: true,
	created_at: "2024-01-15T10:00:00Z",
	views: 10,
	likes: 2,
	cover_image: null,
	category: { id: 1, name: "Tech" },
	tags: [],
	series: null,
	series_order: 0,
	author: null,
};

beforeEach(() => {
	mockRouteQuery = {};
	mockAuth.value = { isAuthenticated: true };
	likesPayload = {
		items: [],
		pagination: { total: 0, page: 1, limit: 12, total_pages: 1 },
	};
	likesReject = null;
	mockUnlikeReject = null;
	mockUnlikeResult = true;
	fetchLikes.mockClear();
	// Reset implementation too: an earlier test's manual-resolve mockImplementation
	// must not leak into later unlike tests (vi.fn clears calls, not impls).
	mockUnlike.mockReset();
	mockUnlike.mockImplementation(async () => {
		if (mockUnlikeReject) throw mockUnlikeReject;
		return mockUnlikeResult;
	});
	mockReplace.mockClear();
	vi.stubGlobal("useRoute", () => ({ path: "/liked", query: mockRouteQuery }));
	vi.stubGlobal("navigateTo", vi.fn());
	vi.stubGlobal("useRouter", () => ({ replace: mockReplace }));
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

async function mountLiked() {
	const wrapper = mount(LikedPage, { global: { stubs } });
	await flushPromises();
	return wrapper;
}

/** Type a term and let the 300ms recall-search debounce elapse. */
async function search(wrapper: ReturnType<typeof mountLiked>, text: string) {
	const input = wrapper.find('input[type="search"]');
	await input.setValue(text);
	await input.trigger("input");
	await vi.advanceTimersByTime(300);
	await flushPromises();
}

describe("Liked page", () => {
	it("redirects guests to /login", async () => {
		mockAuth.value = { isAuthenticated: false };
		await mountLiked();
		expect(mockReplace).toHaveBeenCalledWith("/login");
	});

	it("shows the empty state when the reader has liked nothing", async () => {
		const wrapper = await mountLiked();
		expect(wrapper.text()).toContain("liked.title");
		expect(wrapper.text()).toContain("liked.empty");
		expect(wrapper.text()).toContain("liked.emptyAction");
	});

	it("lists liked posts", async () => {
		likesPayload = {
			items: [samplePost],
			pagination: { total: 1, page: 1, limit: 12, total_pages: 1 },
		};
		const wrapper = await mountLiked();
		expect(wrapper.text()).toContain("A liked post");
		expect(wrapper.text()).toContain("liked.countLabel");
	});

	it("shows a distinct error state with retry, not the empty list", async () => {
		likesReject = new Error("network");
		let wrapper = await mountLiked();
		expect(wrapper.text()).toContain("liked.loadFailed");
		expect(wrapper.text()).not.toContain("liked.empty");

		// Retry recovers the list.
		likesReject = null;
		likesPayload = {
			items: [samplePost],
			pagination: { total: 1, page: 1, limit: 12, total_pages: 1 },
		};
		const retry = wrapper.findAll("button").find((b) => b.text().includes("liked.retry"));
		await retry?.trigger("click");
		await flushPromises();
		expect(wrapper.text()).toContain("A liked post");
		wrapper.unmount();

		// Load failure with a dead session: drop to /login, no error copy.
		mockAuth.value = { isAuthenticated: true };
		likesReject = { stale: true };
		wrapper = await mountLiked();
		expect(mockReplace).toHaveBeenCalledWith("/login");
		expect(wrapper.text()).not.toContain("liked.loadFailed");
		wrapper.unmount();
	});

	it("renders the search box with the recall-search placeholder", async () => {
		likesPayload = {
			items: [samplePost],
			pagination: { total: 1, page: 1, limit: 12, total_pages: 1 },
		};
		const wrapper = await mountLiked();
		const input = wrapper.find('input[type="search"]');
		expect(input.exists()).toBe(true);
		expect(input.attributes("placeholder")).toBe("liked.searchPlaceholder");
		wrapper.unmount();
	});

	it("debounces typing and refetches with the q term", async () => {
		vi.useFakeTimers();
		likesPayload = {
			items: [samplePost],
			pagination: { total: 1, page: 1, limit: 12, total_pages: 1 },
		};
		const wrapper = await mountLiked();
		// Initial load uses a blank q.
		expect(fetchLikes).toHaveBeenLastCalledWith(1, 12, "");

		await search(wrapper, "rust");
		expect(fetchLikes).toHaveBeenLastCalledWith(1, 12, "rust");
		wrapper.unmount();
	});

	it("collapses fast keystrokes into a single request (300ms debounce)", async () => {
		vi.useFakeTimers();
		likesPayload = { items: [], pagination: { total: 0, page: 1, limit: 12, total_pages: 1 } };
		const wrapper = await mountLiked();
		const input = wrapper.find('input[type="search"]');
		await input.setValue("r");
		await input.trigger("input");
		await input.setValue("ru");
		await input.trigger("input");
		await input.setValue("rus");
		await input.trigger("input");
		await vi.advanceTimersByTime(300);
		await flushPromises();
		// Initial mount load + exactly one debounced search.
		expect(fetchLikes.mock.calls.length).toBe(2);
		expect(fetchLikes).toHaveBeenLastCalledWith(1, 12, "rus");
		wrapper.unmount();
	});

	it("a search from a deep page resets to page 1 via the URL", async () => {
		vi.useFakeTimers();
		mockRouteQuery = { page: "3" };
		likesPayload = {
			items: [samplePost],
			pagination: { total: 30, page: 3, limit: 12, total_pages: 3 },
		};
		const wrapper = await mountLiked();
		expect(fetchLikes).toHaveBeenCalledWith(3, 12, "");

		const input = wrapper.find('input[type="search"]');
		await input.setValue("rust");
		await input.trigger("input");
		await vi.advanceTimersByTime(300);
		await flushPromises();

		// The filtered total is smaller, so a stale deep page would overshoot:
		// a search must drop back to page 1 (the watch([page]) reload then picks
		// up the term).
		const navigateTo = vi.mocked(globalThis.navigateTo);
		expect(navigateTo).toHaveBeenCalledWith({ query: { page: undefined } }, { replace: true });
		// And the deep-page search itself did NOT fetch against page 3.
		expect(fetchLikes).toHaveBeenLastCalledWith(3, 12, "");
		wrapper.unmount();
	});

	it("shows a search-aware empty state with a clear-search reset", async () => {
		vi.useFakeTimers();
		likesPayload = { items: [], pagination: { total: 0, page: 1, limit: 12, total_pages: 1 } };
		const wrapper = await mountLiked();

		await search(wrapper, "nothing-here");
		// Neither the "haven't liked anything" copy nor the browse CTA — the
		// search names the term and offers a one-click reset.
		expect(wrapper.text()).toContain("liked.emptySearch");
		expect(wrapper.text()).toContain("liked.clearSearch");
		expect(wrapper.text()).not.toContain("liked.emptyAction");

		const clear = wrapper.findAll("button").find((b) => b.text().includes("liked.clearSearch"));
		await clear?.trigger("click");
		await flushPromises();
		expect(fetchLikes).toHaveBeenLastCalledWith(1, 12, "");
		wrapper.unmount();
	});

	it("the box's x button clears the term and refetches the full list", async () => {
		vi.useFakeTimers();
		likesPayload = {
			items: [samplePost],
			pagination: { total: 1, page: 1, limit: 12, total_pages: 1 },
		};
		const wrapper = await mountLiked();

		await search(wrapper, "rust");
		expect(fetchLikes).toHaveBeenLastCalledWith(1, 12, "rust");

		const x = wrapper.find('button[aria-label="liked.searchClear"]');
		expect(x.exists()).toBe(true);
		await x.trigger("click");
		await flushPromises();
		expect(fetchLikes).toHaveBeenLastCalledWith(1, 12, "");
		expect(wrapper.find('button[aria-label="liked.searchClear"]').exists()).toBe(false);
		wrapper.unmount();
	});
});

describe("Liked page unlike (DEC-415, TASK-433)", () => {
	it("renders a per-card unlike control", async () => {
		likesPayload = {
			items: [samplePost],
			pagination: { total: 1, page: 1, limit: 12, total_pages: 1 },
		};
		const wrapper = await mountLiked();
		const btn = wrapper.find('button[aria-label="liked.unlike"]');
		expect(btn.exists()).toBe(true);
		expect(btn.attributes("title")).toBe("liked.unlike");
		wrapper.unmount();
	});

	it("unliking removes the card, calls unlike(post.id), and decrements the count", async () => {
		likesPayload = {
			items: [samplePost],
			pagination: { total: 1, page: 1, limit: 12, total_pages: 1 },
		};
		const wrapper = await mountLiked();
		expect(wrapper.text()).toContain("A liked post");

		await wrapper.find('button[aria-label="liked.unlike"]').trigger("click");
		await flushPromises();

		expect(mockUnlike).toHaveBeenCalledWith(1);
		// The card leaves the grid (the count row derives from pagination.total,
		// now 0 — and the empty state takes over).
		expect(wrapper.text()).not.toContain("A liked post");
		expect(wrapper.text()).toContain("liked.empty");
		wrapper.unmount();
	});

	it("disables the row's unlike button while its unlike is in flight", async () => {
		let resolveUnlike!: (v: unknown) => void;
		mockUnlike.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveUnlike = resolve;
				}),
		);
		likesPayload = {
			items: [samplePost, { ...samplePost, id: 2, title: "Second liked post" }],
			pagination: { total: 2, page: 1, limit: 12, total_pages: 1 },
		};
		const wrapper = await mountLiked();
		const btns = wrapper.findAll('button[aria-label="liked.unlike"]');
		expect(btns.length).toBe(2);

		await btns[0].trigger("click");
		await flushPromises();
		// Row 1's button is disabled + busy while its unlike is pending; row 2
		// may still be clicked.
		expect((btns[0].element as HTMLButtonElement).disabled).toBe(true);
		expect(btns[0].attributes("aria-busy")).toBe("true");
		expect((btns[1].element as HTMLButtonElement).disabled).toBe(false);

		resolveUnlike(undefined);
		await flushPromises();
		const after = wrapper.findAll('button[aria-label="liked.unlike"]');
		expect(after.every((b) => !(b.element as HTMLButtonElement).disabled)).toBe(true);
		wrapper.unmount();
	});

	it("shows an unlike failure without dropping the card", async () => {
		mockUnlikeReject = new Error("nope");
		likesPayload = {
			items: [samplePost],
			pagination: { total: 1, page: 1, limit: 12, total_pages: 1 },
		};
		const wrapper = await mountLiked();

		await wrapper.find('button[aria-label="liked.unlike"]').trigger("click");
		await flushPromises();

		expect(wrapper.text()).toContain("liked.unlikeFailed");
		// The card stays: a failed unlike must not claim success.
		expect(wrapper.text()).toContain("A liked post");
		wrapper.unmount();
	});

	it("keeps the card when unlike() reports an unpersisted mirror removal", async () => {
		// Offline / 5xx: unlike() (the real one) rolls the local marker back and
		// resolves FALSE — the cloud row still counts this like, so this
		// server-truth page must NOT drop the card (usability deep-dive).
		mockUnlikeResult = false;
		likesPayload = {
			items: [samplePost],
			pagination: { total: 1, page: 1, limit: 12, total_pages: 1 },
		};
		const wrapper = await mountLiked();

		await wrapper.find('button[aria-label="liked.unlike"]').trigger("click");
		await flushPromises();

		expect(wrapper.text()).toContain("liked.unlikeFailed");
		expect(wrapper.text()).toContain("A liked post");
		wrapper.unmount();
	});
});
