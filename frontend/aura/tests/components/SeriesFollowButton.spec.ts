/**
 * SeriesFollowButton component tests (DEC-290, TASK-374).
 *
 * The inline series-follow control attached to the post page's in-series nav
 * box: only signed-in readers see it; follow state is loaded through the
 * imperative getReaderSeriesFollows seam ($fetch — useFetch never sends from a
 * lifecycle callback, ISS-119/TASK-220); clicking follows/unfollows the series
 * and toggles new-part notifications, mirroring the /series page follow block.
 * Dead-session 401s drop the dead token and show the sign-in prompt instead of
 * a generic failure bubble.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const t = vi.fn((key: string) => key);
vi.mock("~~/composables/useLang", () => ({
	useLang: () => ({ t }),
}));

const { mockGet, mockFollow, mockSetNotify, mockUnfollow } = vi.hoisted(() => ({
	mockGet: vi.fn(),
	mockFollow: vi.fn(),
	mockSetNotify: vi.fn(),
	mockUnfollow: vi.fn(),
}));
vi.mock("~~/api/reader/follows", () => ({
	getReaderSeriesFollows: mockGet,
	followReaderSeries: mockFollow,
	setSeriesFollowNotify: mockSetNotify,
	unfollowReaderSeries: mockUnfollow,
}));

import SeriesFollowButton from "../../components/SeriesFollowButton.vue";

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

async function mountButton() {
	wrapper = mount(SeriesFollowButton, {
		props: { seriesId: 7, seriesTitle: "FastAPI Deep Dive" },
		global: { stubs: { Icon: iconStub, NuxtLink: nuxtLinkStub } },
	});
	await flushPromises();
	return wrapper;
}

/**
 * Button by its accessible name. The control deliberately carries NO
 * aria-label (the /series page follow block is the same), so the accessible
 * name is the visible text — under the mocked useLang that is the raw i18n key.
 */
function btn(w: ReturnType<typeof mount>, key: string) {
	return w.findAll("button").find((b) => b.text() === key);
}

function followed(notify = true) {
	mockGet.mockResolvedValue({
		items: [{ id: 7, title: "FastAPI Deep Dive", slug: "x", notify }],
		total: 1,
	});
}

describe("SeriesFollowButton", () => {
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
		expect(btn(w, "series.followingNewParts")?.exists()).toBe(true);
		expect(btn(w, "series.notifyOn")?.exists()).toBe(true);
	});

	it("follows the series on click", async () => {
		localStorage.setItem("reader_token", "tok-1");
		mockGet.mockResolvedValue({ items: [], total: 0 });
		mockFollow.mockResolvedValue({
			series_id: 7,
			series_slug: "x",
			following: true,
			notify: true,
		});
		const w = await mountButton();
		expect(btn(w, "series.followNewParts")?.exists()).toBe(true);
		await btn(w, "series.followNewParts")?.trigger("click");
		await flushPromises();
		expect(mockFollow).toHaveBeenCalledWith(7);
		expect(btn(w, "series.followingNewParts")?.exists()).toBe(true);
	});

	it("toggles new-part notifications while following", async () => {
		localStorage.setItem("reader_token", "tok-1");
		followed();
		mockSetNotify.mockResolvedValue({
			series_id: 7,
			series_slug: "x",
			following: true,
			notify: false,
		});
		const w = await mountButton();
		await btn(w, "series.notifyOn")?.trigger("click");
		await flushPromises();
		expect(mockSetNotify).toHaveBeenCalledWith(7, false);
		expect(btn(w, "series.notifyOff")?.exists()).toBe(true);
	});

	it("unfollows when already following", async () => {
		localStorage.setItem("reader_token", "tok-1");
		followed();
		mockUnfollow.mockResolvedValue(null);
		const w = await mountButton();
		await btn(w, "series.followingNewParts")?.trigger("click");
		await flushPromises();
		expect(mockUnfollow).toHaveBeenCalledWith(7);
		expect(btn(w, "series.followingNewParts")).toBeUndefined();
		expect(btn(w, "series.followNewParts")?.exists()).toBe(true);
	});

	it("stays on the un-followed state when the state load fails", async () => {
		localStorage.setItem("reader_token", "tok-1");
		mockGet.mockRejectedValue(new Error("network"));
		const w = await mountButton();
		expect(btn(w, "series.followNewParts")?.exists()).toBe(true);
		expect(btn(w, "series.followingNewParts")).toBeUndefined();
	});

	it("keeps the control consistent when the follow request fails", async () => {
		localStorage.setItem("reader_token", "tok-1");
		mockGet.mockResolvedValue({ items: [], total: 0 });
		mockFollow.mockRejectedValue(new Error("network"));
		const w = await mountButton();
		await btn(w, "series.followNewParts")?.trigger("click");
		await flushPromises();
		expect(mockFollow).toHaveBeenCalledWith(7);
		expect(btn(w, "series.followingNewParts")).toBeUndefined();
		expect(btn(w, "series.followNewParts")?.exists()).toBe(true);
	});

	it("shows an in-flight spinner while the follow request is pending", async () => {
		localStorage.setItem("reader_token", "tok-1");
		mockGet.mockResolvedValue({ items: [], total: 0 });
		let resolveFollow!: (v: unknown) => void;
		mockFollow.mockReturnValue(
			new Promise((res) => {
				resolveFollow = res;
			}),
		);
		const w = await mountButton();
		await btn(w, "series.followNewParts")?.trigger("click");
		await flushPromises();
		expect(w.find('[data-icon="lucide:loader-2"]').exists()).toBe(true);
		resolveFollow({ series_id: 7, series_slug: "x", following: true, notify: true });
		await flushPromises();
		expect(w.find('[data-icon="lucide:loader-2"]').exists()).toBe(false);
	});

	it("surfaces a transient error bubble when the follow fails (regression: silent no-op)", async () => {
		localStorage.setItem("reader_token", "tok-1");
		mockGet.mockResolvedValue({ items: [], total: 0 });
		mockFollow.mockRejectedValue(new Error("network"));
		const w = await mountButton();
		await btn(w, "series.followNewParts")?.trigger("click");
		await flushPromises();

		const bubble = w.find('[role="status"]');
		expect(bubble.exists()).toBe(true);
		expect(bubble.text()).toContain("series.followFailed");
		// The control itself stays in its pre-failure state (retryable).
		expect(btn(w, "series.followNewParts")?.exists()).toBe(true);
	});

	it("exposes follow and notify state via aria-pressed", async () => {
		localStorage.setItem("reader_token", "tok-1");
		followed();
		const w = await mountButton();
		expect(btn(w, "series.followingNewParts")?.attributes("aria-pressed")).toBe("true");
		expect(btn(w, "series.notifyOn")?.attributes("aria-pressed")).toBe("true");
	});

	// Round-300 deep-dive: every follow surface must route dead sessions to a
	// sign-in prompt, not a useless "failed" bubble. The series-follow control
	// on the post page is a follow surface too — it must behave like the tag
	// chips + the /series page.
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
		await btn(w, "series.followNewParts")?.trigger("click");
		await flushPromises();

		// The dead token is dropped → the control flips to guest…
		expect(w.find("button").exists()).toBe(false);
		// …and the session-expired prompt (with a way back to sign-in) shows.
		expect(w.find('[role="alert"]').text()).toContain("common.sessionExpired");
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
		expect(w.find('[role="alert"]').text()).toContain("common.sessionExpired");
		expect(w.find('[role="status"]').exists()).toBe(false);
	});

	it("still shows the generic bubble for a transient (non-401) follow failure", async () => {
		localStorage.setItem("reader_token", "tok-1");
		mockGet.mockResolvedValue({ items: [], total: 0 });
		mockFollow.mockRejectedValue(new Error("network"));
		const w = await mountButton();
		await btn(w, "series.followNewParts")?.trigger("click");
		await flushPromises();

		expect(w.find('[role="status"]').text()).toContain("series.followFailed");
		expect(w.find('[role="alert"]').exists()).toBe(false);
	});
});
