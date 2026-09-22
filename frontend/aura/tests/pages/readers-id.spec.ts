/**
 * /readers/[id] public profile page tests (DEC-294, TASK-376).
 *
 * Covers: profile header (display_name, join date, verified badge), the
 * comment list with post links, not-found (404), load-failure retry, empty
 * state, and pagination tokens.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reactive, ref } from "vue";

import ReaderProfilePage from "../../app/pages/readers/[id].vue";

// The page fetches profile data inside a top-level `await` (SSR-style), so its
// setup is async — wrap it in a <Suspense> boundary like the other page specs.
const SuspenseWrapper = (PageComponent: typeof ReaderProfilePage) => ({
	components: { PageComponent },
	template:
		"<Suspense>" +
		"<template #default><PageComponent /></template>" +
		"<template #fallback>Loading...</template>" +
		"</Suspense>",
});

let mockPayload: unknown = null;
let mockReject: unknown = null;
let mockLikesPayload: unknown = null;
let mockLikesReject: unknown = null;
let mockSavedPayload: unknown = null;
let mockSavedReject: unknown = null;
// Round-422: manual-release handle for getReaderPublicLikes so a test can hold
// one tab response open while a newer page lands, then release the stale one
// (the tab-fetcher twin of the profile mock's `defer`).
let mockLikesDefer: ((release: (value: unknown) => void) => void) | null = null;
let mockReaderId = "5";
let mockQuery: Record<string, string> = {};
// TASK-478 / ISS-554: records the page arg each getReaderProfile call received
// so a test can assert an invalid ?page= resolves to 1 on the wire.
let mockProfilePages: unknown[] = [];
// ISS-572: per-call behaviors for the profile mock, consumed FIFO. `deferred`
// installs a manual-release promise so a test can hold one response open while
// a newer load lands, then release the stale one.
let mockProfileSteps: Array<{
	payload?: unknown;
	defer?: (release: (value: unknown) => void) => void;
}> = [];

vi.mock("~~/api/public/readers", () => ({
	getReaderProfile: async (_id: number, page?: number) => {
		mockProfilePages.push(page);
		if (mockReject) throw mockReject;
		const step = mockProfileSteps.shift();
		if (step) {
			if (step.defer) {
				return new Promise<unknown>((resolve) => step.defer?.(resolve));
			}
			if ("payload" in step) return step.payload;
		}
		return mockPayload;
	},
	getReaderPublicLikes: async () => {
		if (mockLikesReject) throw mockLikesReject;
		if (mockLikesDefer) {
			// Hold THIS response open until the test releases it; every later
			// call falls back to the static payload (round-422 tab-race test).
			const defer = mockLikesDefer;
			mockLikesDefer = null;
			return new Promise<unknown>((release) => defer(release));
		}
		return mockLikesPayload;
	},
	getReaderPublicBookmarks: async () => {
		if (mockSavedReject) throw mockSavedReject;
		return mockSavedPayload;
	},
}));

vi.mock("~~/composables/useSeo", () => ({
	useSeo: vi.fn(),
}));

vi.mock("~~/composables/useLang", () => ({
	useLang: () => ({ t: (k: string) => k, locale: ref("zh") }),
}));

// Reader-to-reader follow (round 365, DEC-403): the header's ReaderFollowButton
// calls the follow/unfollow seams directly (the profile payload already carries
// is_following, so there is no initial follow-state GET to mock).
const { mockFollowReader, mockUnfollowReader } = vi.hoisted(() => ({
	mockFollowReader: vi.fn(),
	mockUnfollowReader: vi.fn(),
}));
vi.mock("~~/api/reader/follows", () => ({
	followReader: mockFollowReader,
	unfollowReader: mockUnfollowReader,
}));

// Reader block (round 379, DEC-425): the header's ReaderBlockButton seeds from
// the profile's is_blocked stance, so only the block/unblock seams are mocked.
const { mockBlockReader, mockUnblockReader } = vi.hoisted(() => ({
	mockBlockReader: vi.fn(),
	mockUnblockReader: vi.fn(),
}));
vi.mock("~~/api/reader/blocks", () => ({
	blockReader: mockBlockReader,
	unblockReader: mockUnblockReader,
}));

const stubs = {
	Icon: { template: "<svg class='icon-stub' :data-icon='icon' />", props: ["icon"] },
	NuxtLink: { template: "<a class='nuxt-link-stub' :href='to'><slot/></a>", props: ["to"] },
};

const samplePage = {
	profile: {
		id: 5,
		display_name: "Riki",
		avatar_url: null,
		public_likes: false,
		public_bookmarks: false,
		// Round 365 (DEC-403): the public follower count + the caller's own
		// follow stance ride on the profile payload.
		follower_count: 3,
		is_following: false,
		created_at: "2024-01-01T00:00:00Z",
	},
	items: [
		{
			id: 1,
			post_id: 10,
			parent_id: null,
			nickname: "Riki",
			content: "a comment on a post",
			is_approved: true,
			created_at: "2024-06-01T10:00:00Z",
			reader: { id: 5, display_name: "Riki" },
			post: { id: 10, title: "The Post", slug: "the-post" },
		},
	],
	pagination: { total: 1, page: 1, limit: 20, total_pages: 1 },
};

// An opted-in reader (round 360, DEC-393): public_likes true → the profile
// gains a "Liked posts" tab fed by getReaderPublicLikes.
const sampleLikerPage = {
	...samplePage,
	profile: { ...samplePage.profile, public_likes: true },
};

const sampleLikes = {
	items: [
		{
			id: 30,
			title: "Loved post",
			slug: "loved-post",
			category: { id: 1, name: "Tech" },
			likes: 4,
		},
	],
	pagination: { total: 1, page: 1, limit: 20, total_pages: 1 },
};

// A reader who also opts into the curated "Saved posts" tab (round 363,
// DEC-399): public_bookmarks true → the profile gains a third tab.
const sampleSaverPage = {
	...samplePage,
	profile: { ...samplePage.profile, public_bookmarks: true },
};

const sampleSaved = {
	items: [
		{
			id: 40,
			title: "Kept post",
			slug: "kept-post",
			category: { id: 2, name: "Science" },
			views: 9,
		},
	],
	pagination: { total: 1, page: 1, limit: 20, total_pages: 1 },
};

beforeEach(() => {
	mockPayload = null;
	mockReject = null;
	mockLikesPayload = null;
	mockLikesReject = null;
	mockLikesDefer = null;
	mockSavedPayload = null;
	mockSavedReject = null;
	mockReaderId = "5";
	mockQuery = {};
	mockProfilePages = [];
	mockProfileSteps = [];
	mockFollowReader.mockClear();
	mockUnfollowReader.mockClear();
	mockBlockReader.mockClear();
	mockUnblockReader.mockClear();
});

afterEach(() => {
	vi.unstubAllGlobals();
	localStorage.clear();
});

async function mountPage() {
	vi.stubGlobal("useRoute", () => ({
		params: { id: mockReaderId },
		query: mockQuery,
	}));
	vi.stubGlobal("navigateTo", vi.fn());
	const { default: ReaderFollowButton } = await import("../../components/ReaderFollowButton.vue");
	const { default: ReaderBlockButton } = await import("../../components/ReaderBlockButton.vue");
	const wrapper = mount(SuspenseWrapper(ReaderProfilePage), {
		global: { components: { ReaderFollowButton, ReaderBlockButton }, stubs },
	});
	await flushPromises();
	return wrapper;
}

/**
 * Mount with a REACTIVE route query so a test can change ?page= / ?view= after
 * mount and fire the load watcher, which the plain mountPage() (static query)
 * cannot do — the reader load race test (ISS-572) needs that seam.
 */
async function mountPageReactiveQuery(initialQuery: Record<string, string>) {
	// Deep-reactive route: the page computed reads route.query.page on every
	// eval, so a later Object.assign into route.query must be observable —
	// swapping the whole query object wouldn't be (setups captured the old
	// reference). The initial pass must wait for pending to settle.
	const route = reactive({ params: { id: mockReaderId }, query: { ...initialQuery } });
	vi.stubGlobal("useRoute", () => route);
	vi.stubGlobal("navigateTo", vi.fn());
	const { default: ReaderFollowButton } = await import("../../components/ReaderFollowButton.vue");
	const { default: ReaderBlockButton } = await import("../../components/ReaderBlockButton.vue");
	const wrapper = mount(SuspenseWrapper(ReaderProfilePage), {
		global: { components: { ReaderFollowButton, ReaderBlockButton }, stubs },
	});
	await flushPromises();
	return {
		wrapper,
		setQuery: (patch: Record<string, string>) => {
			Object.assign(route.query, patch);
		},
	};
}

/** Sign in a reader (reader_token) with an optional stored profile. */
function signIn(profile?: { id?: number }) {
	localStorage.setItem("reader_token", "reader-jwt");
	if (profile) localStorage.setItem("reader_profile", JSON.stringify(profile));
}

describe("Reader profile page", () => {
	it("renders the reader's display name and join date", async () => {
		mockPayload = samplePage;
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("Riki");
		expect(wrapper.text()).toContain("readerProfile.joined");
		expect(wrapper.find('[data-icon="lucide:badge-check"]').exists()).toBe(true);
	});

	it("renders the reader's avatar when one is set (DEC-299/TASK-378)", async () => {
		mockPayload = {
			...samplePage,
			profile: { ...samplePage.profile, avatar_url: "/static/avatars/riki.png" },
		};
		const wrapper = await mountPage();
		const avatar = wrapper.find('img[src="/static/avatars/riki.png"]');
		expect(avatar.exists()).toBe(true);
	});

	it("shows the initial-letter placeholder when the reader has no avatar (DEC-299/TASK-378)", async () => {
		mockPayload = samplePage;
		const wrapper = await mountPage();
		expect(wrapper.find("img").exists()).toBe(false);
		expect(wrapper.text()).toContain("R"); // first letter of display_name
	});

	it("renders the reader's bio when one is set (round 352)", async () => {
		mockPayload = {
			...samplePage,
			profile: { ...samplePage.profile, bio: "I write about small self-hosted things." },
		};
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("I write about small self-hosted things.");
	});

	it("omits the bio block when the reader has none (round 352)", async () => {
		mockPayload = { ...samplePage, profile: { ...samplePage.profile, bio: null } };
		const wrapper = await mountPage();
		// The bio is the page's only whitespace-pre-wrap paragraph — nothing
		// to render when the reader hasn't written one.
		expect(wrapper.find("p.whitespace-pre-wrap").exists()).toBe(false);
	});

	it("renders a comment with a deep link to that comment on its post", async () => {
		mockPayload = samplePage;
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("a comment on a post");
		// DEC-321: comment-history surfaces must land ON the comment, not the
		// post headline — the post page's CommentList lands #comment-<id>.
		expect(wrapper.find('.nuxt-link-stub[href="/posts/the-post#comment-1"]').exists()).toBe(true);
		expect(wrapper.text()).toContain("The Post");
	});

	it("shows the empty state when the reader has no comments", async () => {
		mockPayload = {
			profile: { id: 5, display_name: "Riki", created_at: null },
			items: [],
			pagination: { total: 0, page: 1, limit: 20, total_pages: 1 },
		};
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("readerProfile.empty");
	});

	it("renders the not-found state for a 404 instead of an error retry", async () => {
		mockReject = { response: { status: 404 } };
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("readerProfile.notFoundTitle");
		expect(wrapper.text()).not.toContain("readerProfile.loadFailed");
	});

	it("surfaces a network failure with a retry", async () => {
		mockReject = new Error("network");
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("readerProfile.loadFailed");
		expect(wrapper.text()).not.toContain("readerProfile.notFoundTitle");
	});

	it("renders pagination controls when there is more than one page", async () => {
		mockPayload = {
			...samplePage,
			items: [samplePage.items[0]],
			pagination: { total: 40, page: 1, limit: 20, total_pages: 2 },
		};
		const wrapper = await mountPage();
		const buttons = wrapper.findAll("button").filter((b) => /^\d+$/.test(b.text()));
		expect(buttons.length).toBeGreaterThan(0);
	});

	it("renders not-found for a non-numeric id instead of a retry", async () => {
		mockReaderId = "abc";
		mockPayload = samplePage;
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("readerProfile.notFoundTitle");
		expect(wrapper.text()).not.toContain("readerProfile.loadFailed");
	});

	it("a slow stale profile response cannot overwrite a newer one (ISS-572)", async () => {
		// Quick page-click + tab-switch fires overlapping load() calls. The
		// older (stale) response must not clobber the newer data or flip the
		// spinner off while the newer request is still in flight.
		mockPayload = samplePage;
		const { wrapper, setQuery } = await mountPageReactiveQuery({});
		// First load settled: render the initial comment.
		expect(wrapper.text()).toContain("a comment on a post");

		// Trigger a second load that will HANG (deferred) — the "older, slower"
		// request. Its response carries a DISTINCT marker (display_name) so the
		// test can prove a stale overwrite never lands.
		let releaseStale!: (value: unknown) => void;
		mockProfileSteps.push({
			defer: (release) => {
				releaseStale = release;
			},
		});
		setQuery({ page: "2" });
		await flushPromises();

		// Trigger a third load that resolves FIRST: a liker page. The newer
		// data must win even though the older request is still pending.
		mockProfileSteps.push({ payload: sampleLikerPage });
		setQuery({ page: "3" });
		await flushPromises();
		// The newer liker page rendered, not the older comment page.
		expect(wrapper.text()).toContain("readerProfile.likesTab");
		expect(wrapper.text()).not.toContain("StaleReader");

		// Now the stale response finally lands — it must be discarded, never
		// replacing the liker page with its marker.
		releaseStale({
			...samplePage,
			profile: { ...samplePage.profile, display_name: "StaleReader" },
		});
		await flushPromises();
		expect(wrapper.text()).not.toContain("StaleReader");
		// The newer profile is still intact (tab still offered, comment count
		// list still the liker payload's).
		expect(wrapper.text()).toContain("readerProfile.likesTab");
	});

	it("a stale likes-tab response cannot overwrite a newer page (round 422)", async () => {
		// load() is seq-guarded (ISS-572), but the discovery-tab fetchers were
		// not: a fast page-click on the Likes tab fires a second loadLikes()
		// while the first is still in flight (both profiles resolve, so each
		// passes its own load()'s seq check), and the last-resolver wrote the
		// grid with no guard — page N could arrive LAST and paint under page
		// N+1's pagination. Round-422 audit: the tab fetchers got their own
		// monotonic generation; this proves a stale older page is dropped.
		mockPayload = sampleLikerPage;
		mockLikesPayload = sampleLikes;
		mockQuery = { view: "likes" };

		// Directly drive the fetchers through a reactive query so a page change
		// re-runs load() → loadLikes() exactly as the UI would.
		const { wrapper, setQuery } = await mountPageReactiveQuery({ view: "likes" });
		// First likes page rendered.
		expect(wrapper.text()).toContain("Loved post");

		// Page 2's likes request HANGS (deferred) — the "older, slower" one.
		let releaseStaleLikes!: (value: unknown) => void;
		mockLikesDefer = (release) => {
			releaseStaleLikes = release;
		};
		setQuery({ view: "likes", page: "2" });
		await flushPromises();

		// Page 3 resolves FIRST with a distinct marker. The newer data must win
		// even though the older page-2 request is still pending.
		mockLikesPayload = {
			...sampleLikes,
			items: [{ ...sampleLikes.items[0], title: "Newest liked post", id: 31 }],
		};
		setQuery({ view: "likes", page: "3" });
		await flushPromises();
		expect(wrapper.text()).toContain("Newest liked post");
		expect(wrapper.text()).not.toContain("Loved post");

		// The stale page-2 response finally lands — it must be discarded, never
		// replacing the newer page with its marker.
		releaseStaleLikes({
			...sampleLikes,
			items: [{ ...sampleLikes.items[0], title: "Stale liked post", id: 30 }],
		});
		await flushPromises();
		expect(wrapper.text()).not.toContain("Stale liked post");
		expect(wrapper.text()).toContain("Newest liked post");

		wrapper.unmount();
	});

	it("drops the page param when an empty profile is deep-linked out of range", async () => {
		mockQuery = { page: "99" };
		mockPayload = {
			profile: { id: 5, display_name: "Riki", created_at: null },
			items: [],
			pagination: { total: 0, page: 1, limit: 20, total_pages: 0 },
		};
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("readerProfile.empty");
		expect(vi.mocked(globalThis.navigateTo)).toHaveBeenCalledWith({ query: {} }, { replace: true });
	});

	it("hides the Likes tab unless the reader opted in (public_likes false)", async () => {
		mockPayload = { ...samplePage, profile: { ...samplePage.profile, public_likes: false } };
		// A ?view=likes deep link on a private reader falls back to comments —
		// the deep link can't force a tab the reader never published.
		mockQuery = { view: "likes" };
		const wrapper = await mountPage();
		expect(wrapper.text()).not.toContain("readerProfile.likesTab");
		expect(wrapper.text()).toContain("a comment on a post");
	});

	it("renders the Likes tab for an opted-in reader (round 360)", async () => {
		mockPayload = sampleLikerPage;
		const wrapper = await mountPage();
		// Default tab is comments; the Likes tab button is offered.
		expect(wrapper.text()).toContain("readerProfile.likesTab");
		expect(wrapper.text()).toContain("a comment on a post");
	});

	it("lists the reader's published liked posts when deep-linked to ?view=likes", async () => {
		mockPayload = sampleLikerPage;
		mockLikesPayload = sampleLikes;
		mockQuery = { view: "likes" };
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("Loved post");
		expect(wrapper.text()).toContain("Tech");
		// The comment tab is not rendered on the likes view.
		expect(wrapper.text()).not.toContain("a comment on a post");
	});

	it("hides the Saved tab unless the reader opted in (public_bookmarks false)", async () => {
		mockPayload = samplePage;
		// A ?view=saved deep link on a private reader falls back to comments —
		// the deep link can't force a tab the reader never published.
		mockQuery = { view: "saved" };
		const wrapper = await mountPage();
		expect(wrapper.text()).not.toContain("readerProfile.savedTab");
		expect(wrapper.text()).toContain("a comment on a post");
	});

	it("renders the Saved tab for an opted-in reader (round 363)", async () => {
		mockPayload = sampleSaverPage;
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("readerProfile.savedTab");
		expect(wrapper.text()).toContain("a comment on a post");
	});

	it("lists the reader's published saved posts when deep-linked to ?view=saved", async () => {
		mockPayload = sampleSaverPage;
		mockSavedPayload = sampleSaved;
		mockQuery = { view: "saved" };
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("Kept post");
		expect(wrapper.text()).toContain("Science");
		// The comment tab is not rendered on the saved view.
		expect(wrapper.text()).not.toContain("a comment on a post");
	});

	it("treats ?view=saved on a likes-only reader as the comments tab", async () => {
		// public_likes true but public_bookmarks false: ?view=saved has no tab
		// to land on, so it falls back (and the Saved data is never fetched).
		mockPayload = sampleLikerPage;
		mockQuery = { view: "saved" };
		const wrapper = await mountPage();
		expect(wrapper.text()).not.toContain("readerProfile.savedTab");
		expect(wrapper.text()).not.toContain("Kept post");
		expect(wrapper.text()).toContain("a comment on a post");
	});
});

describe("Reader follow on the profile header (round 365, DEC-403)", () => {
	function scaledPayload(is_following: boolean, follower_count = 3) {
		return {
			...samplePage,
			profile: { ...samplePage.profile, is_following, follower_count },
		};
	}

	it("shows every visitor the follower count, with no button for guests", async () => {
		mockPayload = samplePage; // follower_count 3, is_following false
		const wrapper = await mountPage();
		// The public count is rendered (aria-label carries the translated label)…
		expect(wrapper.text()).toContain("readerProfile.followerCountMany");
		// …but a signed-out visitor gets no Follow control. Match probe on the
		// exact toggle keys (a substring would trip on followerCount*).
		const buttonTexts = wrapper.findAll("button").map((b) => b.text());
		expect(buttonTexts).not.toContain("readerProfile.follow");
		expect(buttonTexts).not.toContain("readerProfile.following");
	});

	it("lets a signed-in reader follow another reader from the header", async () => {
		mockPayload = scaledPayload(false);
		mockFollowReader.mockResolvedValue({
			reader_id: 5,
			display_name: "Riki",
			following: true,
			notify: true,
		});
		signIn(); // signed in, but viewing reader 5 — not themself

		const wrapper = await mountPage();
		const followBtn = wrapper.findAll("button").find((b) => b.text() === "readerProfile.follow");
		expect(followBtn).toBeDefined();
		if (!followBtn) throw new Error("follow button not found");
		expect(followBtn.attributes("aria-pressed")).toBe("false");

		await followBtn.trigger("click");
		await flushPromises();

		expect(mockFollowReader).toHaveBeenCalledWith(5);
		const followingBtn = wrapper
			.findAll("button")
			.find((b) => b.text() === "readerProfile.following");
		expect(followingBtn).toBeDefined();
		expect(followingBtn?.attributes("aria-pressed")).toBe("true");
	});

	it("seeds the button already-following from the profile's own stance", async () => {
		mockPayload = scaledPayload(true, 9);
		signIn();

		const wrapper = await mountPage();
		const followingBtn = wrapper
			.findAll("button")
			.find((b) => b.text() === "readerProfile.following");
		expect(followingBtn).toBeDefined();
		expect(followingBtn?.attributes("aria-pressed")).toBe("true");
		expect(mockFollowReader).not.toHaveBeenCalled();
	});

	it("hides the follow button on the reader's OWN profile", async () => {
		mockPayload = scaledPayload(false);
		signIn({ id: 5 }); // the profile id — viewing themself

		const wrapper = await mountPage();
		const buttonTexts = wrapper.findAll("button").map((b) => b.text());
		expect(buttonTexts).not.toContain("readerProfile.follow");
		expect(buttonTexts).not.toContain("readerProfile.following");
		// The public count still renders.
		expect(wrapper.text()).toContain("readerProfile.followerCountMany");
	});

	it("drops a dead session and offers sign-in instead of a failed follow", async () => {
		mockPayload = scaledPayload(false);
		mockFollowReader.mockRejectedValue({
			response: { status: 401, _data: { detail: "Could not validate credentials" } },
		});
		signIn();

		const wrapper = await mountPage();
		const followBtn = wrapper.findAll("button").find((b) => b.text() === "readerProfile.follow");
		await followBtn?.trigger("click");
		await flushPromises();

		// The expired token is dropped → the control flips back to guest…
		expect(wrapper.findAll("button").some((b) => b.text() === "readerProfile.follow")).toBe(false);
		// …and the sign-in prompt replaces the generic failure bubble.
		expect(wrapper.text()).toContain("common.sessionExpired");
	});
});

describe("Reader block on the profile header (round 379, DEC-425)", () => {
	function scaledPayload(is_blocked: boolean) {
		return {
			...samplePage,
			profile: { ...samplePage.profile, is_blocked },
		};
	}

	it("shows no block control for a signed-out visitor", async () => {
		mockPayload = scaledPayload(false);
		const wrapper = await mountPage();
		const buttonTexts = wrapper.findAll("button").map((b) => b.text());
		expect(buttonTexts).not.toContain("readerProfile.blockAction");
	});

	it("lets a signed-in reader block another reader from the header", async () => {
		mockPayload = scaledPayload(false);
		mockBlockReader.mockResolvedValue({
			reader_id: 5,
			display_name: "Riki",
			avatar_url: null,
			blocked_at: "x",
		});
		signIn(); // signed in, but viewing reader 5 — not themself
		vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));

		const wrapper = await mountPage();
		const blockBtn = wrapper
			.findAll("button")
			.find((b) => b.text() === "readerProfile.blockAction");
		expect(blockBtn).toBeDefined();
		if (!blockBtn) throw new Error("block button not found");
		expect(blockBtn.attributes("aria-pressed")).toBe("false");

		await blockBtn.trigger("click");
		await flushPromises();

		expect(mockBlockReader).toHaveBeenCalledWith(5);
		const blockedBtn = wrapper.findAll("button").find((b) => b.text() === "readerProfile.blocked");
		expect(blockedBtn?.attributes("aria-pressed")).toBe("true");
	});

	it("seeds the button already-blocked from the profile's own stance", async () => {
		mockPayload = scaledPayload(true);
		signIn();

		const wrapper = await mountPage();
		const blockedBtn = wrapper.findAll("button").find((b) => b.text() === "readerProfile.blocked");
		expect(blockedBtn?.attributes("aria-pressed")).toBe("true");
		expect(mockBlockReader).not.toHaveBeenCalled();
	});

	it("declining the block confirm does not call the API", async () => {
		mockPayload = scaledPayload(false);
		signIn();
		vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));

		const wrapper = await mountPage();
		const blockBtn = wrapper
			.findAll("button")
			.find((b) => b.text() === "readerProfile.blockAction");
		await blockBtn?.trigger("click");
		await flushPromises();

		expect(mockBlockReader).not.toHaveBeenCalled();
		const buttonTexts = wrapper.findAll("button").map((b) => b.text());
		expect(buttonTexts).not.toContain("readerProfile.blocked");
	});

	it("unblocks without a confirm and restores the action label", async () => {
		mockPayload = scaledPayload(true);
		mockUnblockReader.mockResolvedValue(null);
		signIn();

		const wrapper = await mountPage();
		const blockedBtn = wrapper.findAll("button").find((b) => b.text() === "readerProfile.blocked");
		await blockedBtn?.trigger("click");
		await flushPromises();

		expect(mockUnblockReader).toHaveBeenCalledWith(5);
		const buttonTexts = wrapper.findAll("button").map((b) => b.text());
		expect(buttonTexts).toContain("readerProfile.blockAction");
	});

	it("hides the block control on the reader's OWN profile", async () => {
		mockPayload = scaledPayload(false);
		signIn({ id: 5 }); // the profile id — viewing themself

		const wrapper = await mountPage();
		const buttonTexts = wrapper.findAll("button").map((b) => b.text());
		expect(buttonTexts).not.toContain("readerProfile.blockAction");
		expect(buttonTexts).not.toContain("readerProfile.blocked");
	});

	// TASK-478 / ISS-554: an invalid ?page= must resolve to page 1 on the wire.
	// The un-clamped computed forwarded NaN/0 to getReaderProfile (guaranteed
	// 422) while the clamp watcher short-circuits NaN/<2, bricking the profile
	// with a dead Retry. Clamp at the computed (follows.vue pattern).
	it.each([
		["non-numeric", "abc"],
		["zero", "0"],
		["negative", "-3"],
	])("clamps an invalid %s ?page= to 1 for the profile fetch", async (_label, pageVal) => {
		mockPayload = samplePage;
		mockQuery = { page: pageVal };
		const wrapper = await mountPage();
		// The FIRST profile fetch (comments tab) must page 1, never NaN/0.
		expect(mockProfilePages[0]).toBe(1);
		// The profile still renders (no error/retry dead-end).
		expect(wrapper.text()).toContain("Riki");
	});
});
