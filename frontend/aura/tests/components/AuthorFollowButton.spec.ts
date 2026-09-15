/**
 * AuthorFollowButton component tests (author follow, round 353 / DEC-379).
 *
 * The inline follow control attached to the post page's author byline: only
 * signed-in readers see it; follow state is loaded through the imperative
 * getReaderAuthorFollows seam ($fetch — useFetch never sends from a lifecycle
 * callback, ISS-119/TASK-220); clicking follows/unfollows the pen-named author
 * in place. The per-author notify toggle lives in /account, so here it is a
 * single follow/unfollow toggle. Dead-session 401s drop the expired token and
 * show the sign-in prompt instead of a generic failure bubble (round-300
 * guard, mirrors SeriesFollowButton).
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const t = vi.fn((key: string) => key);
vi.mock("~~/composables/useLang", () => ({
	useLang: () => ({ t }),
}));

const { mockGet, mockFollow, mockUnfollow } = vi.hoisted(() => ({
	mockGet: vi.fn(),
	mockFollow: vi.fn(),
	mockUnfollow: vi.fn(),
}));
vi.mock("~~/api/reader/follows", () => ({
	getReaderAuthorFollows: mockGet,
	followReaderAuthor: mockFollow,
	unfollowReaderAuthor: mockUnfollow,
}));

import AuthorFollowButton from "../../components/AuthorFollowButton.vue";

const iconStub = {
	name: "Icon",
	template: '<i data-testid="icon" :data-icon="icon"></i>',
	props: ["icon"],
};

const nuxtLinkStub = {
	name: "NuxtLink",
	template: '<a :href="to"><slot /></a>',
	props: ["to"],
};

let wrapper: ReturnType<typeof mount> | undefined;

async function mountButton(authorId = 7, authorName = "Pen Author") {
	wrapper = mount(AuthorFollowButton, {
		props: { authorId, authorName },
		global: { stubs: { Icon: iconStub, NuxtLink: nuxtLinkStub } },
	});
	await flushPromises();
	return wrapper;
}

/**
 * Button by its accessible name. The control deliberately carries NO
 * aria-label (the byline is its context), so the accessible name is the
 * visible text — under the mocked useLang that is the raw i18n key.
 */
function btn(w: ReturnType<typeof mount>, key: string) {
	return w.findAll("button").find((b) => b.text() === key);
}

function followed() {
	mockGet.mockResolvedValue({
		items: [{ author_id: 7, display_name: "Pen Author", notify: true }],
		total: 1,
	});
}

describe("AuthorFollowButton", () => {
	afterEach(() => {
		// Unmount the previous wrapper: the watch holds the module-level
		// `signedIn` ref, so a still-mounted prior instance would refire its
		// state load when the next test flips reader_token (leaked-watcher
		// class — see vue-test-leaked-debounce-timers).
		wrapper?.unmount();
		wrapper = undefined;
	});

	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
	});

	it("renders nothing for guests and never fetches follow state", async () => {
		const w = await mountButton();
		expect(w.find("button").exists()).toBe(false);
		expect(mockGet).not.toHaveBeenCalled();
	});

	it("loads follow state on mount for a signed-in reader", async () => {
		localStorage.setItem("reader_token", "tok-1");
		followed();
		const w = await mountButton();
		expect(mockGet).toHaveBeenCalledTimes(1);
		expect(btn(w, "post.followingAuthor")?.exists()).toBe(true);
		expect(btn(w, "post.followingAuthor")?.attributes("aria-pressed")).toBe("true");
	});

	it("follows the author on click (Follow → Following)", async () => {
		localStorage.setItem("reader_token", "tok-1");
		mockGet.mockResolvedValue({ items: [], total: 0 });
		mockFollow.mockResolvedValue({
			author_id: 7,
			display_name: "Pen Author",
			following: true,
			notify: true,
		});
		const w = await mountButton();
		expect(btn(w, "post.followAuthor")?.exists()).toBe(true);
		await btn(w, "post.followAuthor")?.trigger("click");
		await flushPromises();
		expect(mockFollow).toHaveBeenCalledWith(7);
		expect(btn(w, "post.followingAuthor")?.exists()).toBe(true);
	});

	it("unfollows when already following (Following → Follow)", async () => {
		localStorage.setItem("reader_token", "tok-1");
		followed();
		mockUnfollow.mockResolvedValue(null);
		const w = await mountButton();
		await btn(w, "post.followingAuthor")?.trigger("click");
		await flushPromises();
		expect(mockUnfollow).toHaveBeenCalledWith(7);
		expect(btn(w, "post.followingAuthor")).toBeUndefined();
		expect(btn(w, "post.followAuthor")?.exists()).toBe(true);
	});

	it("recognises a different author by id in the loaded follow list", async () => {
		// The follow-state GET lists ALL followed authors; the button only
		// lights up for the byline's own author_id (regression guard).
		localStorage.setItem("reader_token", "tok-1");
		mockGet.mockResolvedValue({
			items: [{ author_id: 99, display_name: "Someone Else", notify: true }],
			total: 1,
		});
		const w = await mountButton(7, "Pen Author");
		expect(btn(w, "post.followAuthor")?.exists()).toBe(true);
		expect(btn(w, "post.followAuthor")?.attributes("aria-pressed")).toBe("false");
	});

	it("stays on the un-followed state when the state load fails", async () => {
		localStorage.setItem("reader_token", "tok-1");
		mockGet.mockRejectedValue(new Error("network"));
		const w = await mountButton();
		expect(btn(w, "post.followAuthor")?.exists()).toBe(true);
		expect(btn(w, "post.followingAuthor")).toBeUndefined();
	});

	it("keeps the control consistent when the follow request fails", async () => {
		localStorage.setItem("reader_token", "tok-1");
		mockGet.mockResolvedValue({ items: [], total: 0 });
		mockFollow.mockRejectedValue(new Error("network"));
		const w = await mountButton();
		await btn(w, "post.followAuthor")?.trigger("click");
		await flushPromises();
		expect(mockFollow).toHaveBeenCalledWith(7);
		expect(btn(w, "post.followingAuthor")).toBeUndefined();
		expect(btn(w, "post.followAuthor")?.exists()).toBe(true);
	});

	it("disables the button while the follow request is in flight", async () => {
		localStorage.setItem("reader_token", "tok-1");
		mockGet.mockResolvedValue({ items: [], total: 0 });
		let resolveFollow!: (v: unknown) => void;
		mockFollow.mockReturnValue(
			new Promise((res) => {
				resolveFollow = res;
			}),
		);
		const w = await mountButton();
		await btn(w, "post.followAuthor")?.trigger("click");
		await flushPromises();
		expect(btn(w, "post.followAuthor")?.attributes("disabled")).toBeDefined();
		expect(btn(w, "post.followAuthor")?.attributes("aria-busy")).toBe("true");
		resolveFollow({
			author_id: 7,
			display_name: "Pen Author",
			following: true,
			notify: true,
		});
		await flushPromises();
		expect(btn(w, "post.followingAuthor")?.attributes("disabled")).toBeUndefined();
	});

	it("surfaces a transient error bubble when the follow fails (regression: silent no-op)", async () => {
		localStorage.setItem("reader_token", "tok-1");
		mockGet.mockResolvedValue({ items: [], total: 0 });
		mockFollow.mockRejectedValue(new Error("network"));
		const w = await mountButton();
		await btn(w, "post.followAuthor")?.trigger("click");
		await flushPromises();

		const bubble = w.find('[role="status"]');
		expect(bubble.exists()).toBe(true);
		expect(bubble.text()).toContain("post.followAuthorFailed");
		// The control itself stays in its pre-failure state (retryable).
		expect(btn(w, "post.followAuthor")?.exists()).toBe(true);
	});

	function staleSessionError() {
		return {
			response: { status: 401, _data: { detail: "Could not validate credentials" } },
		};
	}

	it("drops the dead session and shows the sign-in prompt instead of a generic failure", async () => {
		localStorage.setItem("reader_token", "tok-1");
		mockGet.mockResolvedValue({ items: [], total: 0 });
		mockFollow.mockRejectedValue(staleSessionError());
		const w = await mountButton();
		await btn(w, "post.followAuthor")?.trigger("click");
		await flushPromises();

		// The dead token is dropped → the control flips to guest…
		expect(w.find("button").exists()).toBe(false);
		// …and the session-expired prompt (with a way back to sign-in) shows.
		expect(w.text()).toContain("common.sessionExpired");
		expect(w.find('a[href="/login"]').exists()).toBe(true);
		// The generic follow-failed bubble must not appear.
		expect(w.find('[role="status"]').exists()).toBe(false);
	});

	it("detects the dead session on the initial state load, with no wasted tap", async () => {
		localStorage.setItem("reader_token", "tok-1");
		// The follows GET itself 401s — a returning reader with an expired token.
		mockGet.mockRejectedValue(staleSessionError());
		const w = await mountButton();
		await flushPromises();

		expect(w.find("button").exists()).toBe(false);
		expect(w.text()).toContain("common.sessionExpired");
		expect(w.find('[role="status"]').exists()).toBe(false);
	});

	it("still shows the generic bubble for a transient (non-401) follow failure", async () => {
		localStorage.setItem("reader_token", "tok-1");
		mockGet.mockResolvedValue({ items: [], total: 0 });
		mockFollow.mockRejectedValue(new Error("network"));
		const w = await mountButton();
		await btn(w, "post.followAuthor")?.trigger("click");
		await flushPromises();

		expect(w.find('[role="status"]').text()).toContain("post.followAuthorFailed");
	});
});
