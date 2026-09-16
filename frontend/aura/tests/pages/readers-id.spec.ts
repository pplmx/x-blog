/**
 * /readers/[id] public profile page tests (DEC-294, TASK-376).
 *
 * Covers: profile header (display_name, join date, verified badge), the
 * comment list with post links, not-found (404), load-failure retry, empty
 * state, and pagination tokens.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

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
let mockReaderId = "5";
let mockQuery: Record<string, string> = {};

vi.mock("~~/api/public/readers", () => ({
	getReaderProfile: async () => {
		if (mockReject) throw mockReject;
		return mockPayload;
	},
	getReaderPublicLikes: async () => {
		if (mockLikesReject) throw mockLikesReject;
		return mockLikesPayload;
	},
}));

vi.mock("~~/composables/useSeo", () => ({
	useSeo: vi.fn(),
}));

vi.mock("~~/composables/useLang", () => ({
	useLang: () => ({ t: (k: string) => k, locale: ref("zh") }),
}));

const stubs = {
	Icon: { template: "<svg class='icon-stub' :data-icon='icon' />", props: ["icon"] },
	NuxtLink: { template: "<a class='nuxt-link-stub' :href='to'><slot/></a>", props: ["to"] },
};

const samplePage = {
	profile: { id: 5, display_name: "Riki", avatar_url: null, created_at: "2024-01-01T00:00:00Z" },
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

beforeEach(() => {
	mockPayload = null;
	mockReject = null;
	mockLikesPayload = null;
	mockLikesReject = null;
	mockReaderId = "5";
	mockQuery = {};
});

afterEach(() => {
	vi.unstubAllGlobals();
});

async function mountPage() {
	vi.stubGlobal("useRoute", () => ({
		params: { id: mockReaderId },
		query: mockQuery,
	}));
	vi.stubGlobal("navigateTo", vi.fn());
	const wrapper = mount(SuspenseWrapper(ReaderProfilePage), { global: { stubs } });
	await flushPromises();
	return wrapper;
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
});
