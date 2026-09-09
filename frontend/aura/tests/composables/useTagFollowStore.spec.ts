/**
 * useTagFollowStore composable tests (DEC-196, TASK-216).
 *
 * The shared reader tag-follow cache keys its load by the stored reader token
 * so every TagFollowButton on a page shares one GET. `invalidate()` drops only
 * the load cache (deep-dive): the account page mutates tag follows through its
 * own API calls, and without an explicit invalidate every tag chip elsewhere
 * would keep serving the pre-change follow state for the whole session.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const getTagFollows = vi.fn();
const followTag = vi.fn();
const setNotify = vi.fn();
const unfollowTag = vi.fn();

vi.mock("~~/api/reader/follows", () => ({
	getReaderTagFollows: (...a: unknown[]) => getTagFollows(...a),
	followReaderTag: (...a: unknown[]) => followTag(...a),
	setTagFollowNotify: (...a: unknown[]) => setNotify(...a),
	unfollowReaderTag: (...a: unknown[]) => unfollowTag(...a),
}));

import { useTagFollowStore } from "../../composables/useTagFollowStore";

const TOKEN = "test-reader-token";

describe("useTagFollowStore", () => {
	beforeEach(() => {
		localStorage.setItem("reader_token", TOKEN);
		getTagFollows.mockReset();
		followTag.mockReset();
		setNotify.mockReset();
		unfollowTag.mockReset();
		useTagFollowStore().reset();
	});

	afterEach(() => {
		localStorage.removeItem("reader_token");
	});

	it("invalidate() makes the next ensureLoaded refetch instead of serving the cache", async () => {
		getTagFollows.mockResolvedValue({ items: [{ id: 1, name: "t", notify: false }], total: 1 });
		const store = useTagFollowStore();

		await store.ensureLoaded();
		expect(store.following(1).value).toBe(true);
		expect(getTagFollows).toHaveBeenCalledTimes(1);

		// The cache serves the second load with no refetch.
		getTagFollows.mockClear();
		await store.ensureLoaded();
		expect(getTagFollows).not.toHaveBeenCalled();

		// invalidate() (called by the account page after its own tag mutations)
		// drops the load cache — the next ensureLoaded re-reads the API, so a tag
		// unfollowed on /account stops rendering as followed on /tags + post pages.
		store.invalidate();
		getTagFollows.mockResolvedValue({ items: [], total: 0 });
		await store.ensureLoaded();
		expect(getTagFollows).toHaveBeenCalledTimes(1);
		expect(store.following(1).value).toBe(false);
	});

	it("invalidate() mid-load discards the in-flight snapshot (generation guard)", async () => {
		// An in-flight getReaderTagFollows that resolves AFTER an invalidate()
		// must not commit its pre-mutation snapshot — otherwise it re-stamps the
		// cache key and every chip serves stale follow state for the session.
		let resolveLoad!: (v: unknown) => void;
		getTagFollows.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveLoad = resolve;
				}),
		);
		const store = useTagFollowStore();
		const loading = store.ensureLoaded(); // hangs on the GET
		await Promise.resolve();

		// The account page mutates a tag follow and invalidates while the GET is
		// still in flight.
		store.invalidate();
		resolveLoad({ items: [{ id: 1, name: "t", notify: false }], total: 1 });
		await loading;

		// The stale snapshot was NOT committed.
		expect(store.following(1).value).toBe(false);

		// The next ensureLoaded refetches the post-mutation truth.
		getTagFollows.mockResolvedValue({ items: [], total: 0 });
		await store.ensureLoaded();
		expect(store.following(1).value).toBe(false);
		expect(getTagFollows).toHaveBeenCalledTimes(2);
	});

	it("reset() drops both the cache and the rendered entries", async () => {
		getTagFollows.mockResolvedValue({ items: [{ id: 1, name: "t", notify: true }], total: 1 });
		const store = useTagFollowStore();
		await store.ensureLoaded();
		expect(store.following(1).value).toBe(true);

		store.reset();
		expect(store.following(1).value).toBe(false);
		// A refetch on the next ensureLoaded repopulates.
		getTagFollows.mockClear();
		getTagFollows.mockResolvedValue({ items: [{ id: 1, name: "t", notify: true }], total: 1 });
		await store.ensureLoaded();
		expect(getTagFollows).toHaveBeenCalledTimes(1);
		expect(store.following(1).value).toBe(true);
	});

	it("ensureLoaded is a no-op (with reset) when no reader token is stored", async () => {
		localStorage.removeItem("reader_token");
		const store = useTagFollowStore();
		expect(await store.ensureLoaded()).toBe(false);
		expect(getTagFollows).not.toHaveBeenCalled();
		expect(store.following(1).value).toBe(false);
	});

	it("concurrent ensureLoaded calls share one in-flight fetch", async () => {
		let resolveLoad!: (v: unknown) => void;
		getTagFollows.mockReturnValue(new Promise((r) => (resolveLoad = r)));
		const store = useTagFollowStore();
		const first = store.ensureLoaded();
		const second = store.ensureLoaded(); // must join the running load, not refetch
		resolveLoad({ items: [{ id: 3, name: "t", notify: false }], total: 1 });
		expect(await first).toBe(true);
		expect(await second).toBe(true);
		expect(getTagFollows).toHaveBeenCalledTimes(1);
		expect(store.following(3).value).toBe(true);
	});

	it("a failed follow-list fetch resolves false and stays empty", async () => {
		getTagFollows.mockRejectedValue(new Error("network"));
		const store = useTagFollowStore();
		expect(await store.ensureLoaded()).toBe(false);
		expect(store.following(1).value).toBe(false);
	});

	it("toggleFollow is a no-op while the same tag is already busy", async () => {
		getTagFollows.mockResolvedValue({ items: [{ id: 1, name: "t", notify: false }], total: 1 });
		let resolveUnfollow!: (v: unknown) => void;
		unfollowTag.mockReturnValue(new Promise((r) => (resolveUnfollow = r)));
		const store = useTagFollowStore();
		await store.ensureLoaded();
		expect(store.following(1).value).toBe(true);

		const first = store.toggleFollow(1); // unfollow in flight → busy
		expect(store.busy(1).value).toBe(true);
		store.toggleFollow(1); // busy guard → ignored (one in-flight op per tag)
		resolveUnfollow({ done: true });
		await first;
		expect(unfollowTag).toHaveBeenCalledTimes(1);
		expect(store.following(1).value).toBe(false);
		expect(store.busy(1).value).toBe(false);
	});

	it("toggleFollow follows when not currently followed, persisting the API notify state", async () => {
		followTag.mockResolvedValue({ id: 9, notify: true });
		const store = useTagFollowStore();
		await store.toggleFollow(9);
		expect(followTag).toHaveBeenCalledWith(9);
		expect(store.following(9).value).toBe(true);
		expect(store.busy(9).value).toBe(false);
	});

	it("setNotify guards locally when the tag is not followed", async () => {
		const store = useTagFollowStore();
		await store.setNotify(42, true);
		expect(setNotify).not.toHaveBeenCalled();
		expect(store.notify(42).value).toBe(true); // not-followed default
	});

	it("followed tags surface their persisted notify preference", async () => {
		getTagFollows.mockResolvedValue({ items: [{ id: 5, name: "t", notify: false }], total: 1 });
		const store = useTagFollowStore();
		await store.ensureLoaded();
		expect(store.following(5).value).toBe(true);
		expect(store.notify(5).value).toBe(false);
	});
});
