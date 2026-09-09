/**
 * useReadingHistory composable tests (DEC-116, TASK-170).
 *
 * The history source follows the reader: a signed-in reader loads/clears the
 * server-backed trail (cross-device), while guests use the local localStorage
 * trail. Server fetch failures fall back to the local trail.
 */

import { flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const authRef = ref(false);
const localRecent = ref<{ slug: string; title: string; viewedAt?: number }[]>([]);
const localClear = vi.fn(() => {
	localRecent.value = [];
});
const fetchHistory = vi.fn();
const fetchStats = vi.fn();
const clearHistoryApi = vi.fn();
const importHistoryApi = vi.fn();

vi.mock("~~/api/reader/history", () => ({
	getReaderHistory: (...a: unknown[]) => fetchHistory(...a),
	getReaderHistoryStats: (...a: unknown[]) => fetchStats(...a),
	clearReaderHistory: (...a: unknown[]) => clearHistoryApi(...a),
	importReaderHistory: (...a: unknown[]) => importHistoryApi(...a),
}));

vi.mock("../../composables/useReaderAuth", () => ({
	useReaderAuth: () => ({ isAuthenticated: authRef }),
}));

vi.mock("../../composables/useRecentlyViewed", () => ({
	useRecentlyViewed: () => ({
		recent: localRecent,
		record: vi.fn(),
		clear: localClear,
	}),
}));

import { useReadingHistory } from "../../composables/useReadingHistory";

describe("useReadingHistory (TASK-170)", () => {
	beforeEach(() => {
		authRef.value = false;
		localRecent.value = [];
		fetchHistory.mockReset();
		fetchStats.mockReset();
		clearHistoryApi.mockReset();
		importHistoryApi.mockReset();
		localClear.mockClear();
	});

	it("loads from the local trail for guests", async () => {
		localRecent.value = [{ slug: "a", title: "A", viewedAt: 123 }];
		const { load, history, stats } = useReadingHistory();
		await load();
		expect(history.value).toEqual([{ slug: "a", title: "A", viewedAt: 123 }]);
		expect(fetchHistory).not.toHaveBeenCalled();
		expect(stats.value).toBeNull();
		expect(stats.value).toBeNull();
	});

	it("loads from the API when authenticated, mapping viewed_at", async () => {
		authRef.value = true;
		fetchHistory.mockResolvedValue({
			items: [
				{ id: 1, title: "Server A", slug: "s-a", viewed_at: "2024-01-15T10:30:00Z" },
				{ id: 2, title: "Server B", slug: "s-b", viewed_at: null },
			],
			total: 2,
			page: 1,
			limit: 100,
			total_pages: 1,
		});
		const { load, history } = useReadingHistory();
		await load();
		expect(fetchHistory).toHaveBeenCalledWith(1, 100, "");
		expect(history.value[0]).toEqual({
			slug: "s-a",
			title: "Server A",
			viewedAt: Date.parse("2024-01-15T10:30:00Z"),
		});
		expect(history.value[1]).toEqual({ slug: "s-b", title: "Server B", viewedAt: undefined });
	});

	it("maps a zone-less viewed_at as UTC, not local wall-clock (deep-dive)", async () => {
		// The server serializes viewed_at as naive UTC (no zone marker);
		// Date.parse would have read it as the browser's LOCAL wall-clock and
		// shifted the instant by the reader's UTC offset. parseApiDate appends
		// "Z" (DEC-213).
		authRef.value = true;
		fetchHistory.mockResolvedValue({
			items: [{ id: 1, title: "Server A", slug: "s-a", viewed_at: "2024-01-15T10:30:00" }],
			total: 1,
			page: 1,
			limit: 100,
			total_pages: 1,
		});
		fetchStats.mockResolvedValue(null);
		const { load, history } = useReadingHistory();
		await load();
		expect(history.value[0].viewedAt).toBe(Date.UTC(2024, 0, 15, 10, 30, 0));
	});

	it("falls back to the local trail when the API call fails, flagging loadFailed", async () => {
		authRef.value = true;
		localRecent.value = [{ slug: "l", title: "Local", viewedAt: 5 }];
		fetchHistory.mockRejectedValue(new Error("network"));
		const { load, history, loadFailed } = useReadingHistory();
		await load();
		expect(history.value).toEqual([{ slug: "l", title: "Local", viewedAt: 5 }]);
		// The page renders a labeled fallback + retry off this flag instead of
		// presenting a false "no history yet" empty state.
		expect(loadFailed.value).toBe(true);
	});

	it("clear() resets loadFailed so a stale banner cannot hide the empty state", async () => {
		authRef.value = true;
		fetchHistory.mockRejectedValue(new Error("network"));
		const { load, clear, loadFailed } = useReadingHistory();
		await load();
		expect(loadFailed.value).toBe(true);
		// Clearing the (fallback) trail must also clear the failure flag, or the
		// banner would keep hiding the now-legitimate empty state.
		await clear();
		expect(loadFailed.value).toBe(false);
	});

	it("clears loadFailed once a retry succeeds", async () => {
		authRef.value = true;
		fetchHistory.mockRejectedValueOnce(new Error("network"));
		fetchHistory.mockResolvedValue({ items: [], total: 0, page: 1, limit: 100, total_pages: 1 });
		const { load, loadFailed } = useReadingHistory();
		await load();
		expect(loadFailed.value).toBe(true);
		await load();
		expect(loadFailed.value).toBe(false);
	});

	it("a stale response cannot overwrite a newer one (ISS-128 seq guard)", async () => {
		authRef.value = true;
		// First (older) search is slow; the second resolves first.
		fetchHistory.mockImplementationOnce(
			() =>
				new Promise((resolve) =>
					setTimeout(
						() =>
							resolve({ items: [{ id: 1, title: "Old", slug: "old", viewed_at: null }], total: 1 }),
						50,
					),
				),
		);
		fetchHistory.mockImplementationOnce(() =>
			Promise.resolve({ items: [{ id: 2, title: "New", slug: "new", viewed_at: null }], total: 1 }),
		);
		const { load, history } = useReadingHistory();
		const older = load("a");
		await load("ab");
		expect(history.value[0]?.title).toBe("New");
		await older; // slow response resolves last — must be dropped
		expect(history.value[0]?.title).toBe("New");
		expect(history.value).toHaveLength(1);
	});

	it("guest clear only clears the local trail", async () => {
		localRecent.value = [{ slug: "a", title: "A", viewedAt: 1 }];
		const { clear, history } = useReadingHistory();
		await clear();
		expect(clearHistoryApi).not.toHaveBeenCalled();
		expect(localClear).toHaveBeenCalled();
		expect(history.value).toEqual([]);
	});

	it("authenticated clear calls the API, clears the local mirror, and resets stats", async () => {
		authRef.value = true;
		fetchHistory.mockResolvedValue({ items: [], total: 0 });
		fetchStats.mockResolvedValue({ total_posts: 1, total_reading_minutes: 2, recent: [] });
		const { clear, stats } = useReadingHistory();
		await clear();
		expect(clearHistoryApi).toHaveBeenCalled();
		expect(localClear).toHaveBeenCalled();
		expect(stats.value).toBeNull();
	});

	it("clear invalidates an in-flight load, so its stale response cannot resurrect the cleared list", async () => {
		// Round 263: the history page's Clear button is reachable while the
		// initial onMounted load() is still in flight (it renders during the
		// skeleton). clear() must bump the monotonic guard (ISS-128) that
		// load()/loadMore() use — otherwise the slow, pre-clear response passes
		// the stale check and repopulates the list the reader just deleted.
		authRef.value = true;
		let resolveHistory!: (v: unknown) => void;
		fetchHistory.mockReturnValue(
			new Promise((r) => {
				resolveHistory = r;
			}),
		);
		fetchStats.mockResolvedValue({ total_posts: 1, total_reading_minutes: 2 });
		const { load, clear, history, loading } = useReadingHistory();

		const inFlight = load(); // not awaited — the request is still running
		expect(loading.value).toBe(true);
		await clear(); // reader clears while the load is unresolved
		expect(history.value).toEqual([]);

		// The stale pre-clear response lands AFTER the clear…
		resolveHistory({
			items: [{ id: 1, title: "Old A", slug: "old-a", viewed_at: "2024-01-15T10:30:00Z" }],
			total: 1,
			page: 1,
			limit: 100,
		});
		await inFlight;

		// …and must NOT repopulate the list, nor leave the spinner stuck.
		expect(history.value).toEqual([]);
		expect(loading.value).toBe(false);
	});

	it("exposes serverEnabled reflecting auth", () => {
		const a = useReadingHistory();
		expect(a.serverEnabled.value).toBe(false);
		authRef.value = true;
		const b = useReadingHistory();
		expect(b.serverEnabled.value).toBe(true);
	});

	it("maps streak + activity fields from the server stats (TASK-201)", async () => {
		authRef.value = true;
		fetchHistory.mockResolvedValue({ items: [], total: 0 });
		fetchStats.mockResolvedValue({
			total_posts: 3,
			total_reading_minutes: 40,
			current_streak: 2,
			longest_streak: 6,
			activity: [
				{ date: "2026-08-22", count: 1 },
				{ date: "2026-08-23", count: 3 },
			],
			recent: [],
		});
		const { load, stats } = useReadingHistory();
		await load();
		expect(stats.value).toMatchObject({
			totalPosts: 3,
			totalReadingMinutes: 40,
			currentStreak: 2,
			longestStreak: 6,
			activity: [
				{ date: "2026-08-22", count: 1 },
				{ date: "2026-08-23", count: 3 },
			],
		});
	});

	it("pendingDeviceCount is 0 for guests even with a local trail", async () => {
		localRecent.value = [{ slug: "a", title: "A", viewedAt: 1 }];
		const { load, pendingDeviceCount } = useReadingHistory();
		await load();
		expect(pendingDeviceCount.value).toBe(0);
	});

	it("pendingDeviceCount counts device records the server history does not cover yet", async () => {
		authRef.value = true;
		localRecent.value = [
			{ slug: "a", title: "A", viewedAt: 10 },
			{ slug: "b", title: "B", viewedAt: 20 },
		];
		fetchHistory.mockResolvedValue({
			items: [{ id: 1, title: "A", slug: "a", viewed_at: null }],
			total: 1,
			page: 1,
			limit: 100,
			total_pages: 1,
		});
		const { load, pendingDeviceCount } = useReadingHistory();
		await load();
		// "a" is already server-side; only "b" is pending migration.
		expect(pendingDeviceCount.value).toBe(1);
	});

	it("importLocalTrail sends only fresh records mapped to UTC ISO, then reloads", async () => {
		authRef.value = true;
		localRecent.value = [{ slug: "b", title: "B", viewedAt: Date.UTC(2024, 2, 1, 10, 30, 0) }];
		// First load: only "a" is server-side, so "b" is pending.
		fetchHistory.mockResolvedValueOnce({
			items: [{ id: 1, title: "A", slug: "a", viewed_at: null }],
			total: 1,
			page: 1,
			limit: 100,
			total_pages: 1,
		});
		// After import the reload sees the server list covering "b" as well.
		fetchHistory.mockResolvedValue({
			items: [
				{ id: 1, title: "A", slug: "a", viewed_at: null },
				{ id: 2, title: "B", slug: "b", viewed_at: "2024-03-01T10:30:00" },
			],
			total: 2,
			page: 1,
			limit: 100,
			total_pages: 1,
		});
		importHistoryApi.mockResolvedValue({ imported: 1, skipped: 0 });

		const { load, pendingDeviceCount, importLocalTrail } = useReadingHistory();
		await load();
		expect(pendingDeviceCount.value).toBe(1);

		const result = await importLocalTrail();
		expect(result).toEqual({ imported: 1, skipped: 0 });
		// Only the not-yet-server record is sent, with its read instant preserved.
		expect(importHistoryApi).toHaveBeenCalledWith([
			{ slug: "b", viewed_at: "2024-03-01T10:30:00.000Z" },
		]);
		// The reload pulled "b" into the server list, so the offer collapses.
		expect(pendingDeviceCount.value).toBe(0);
	});

	it("importLocalTrail is a no-op for a guest (nothing to offer)", async () => {
		localRecent.value = [{ slug: "a", title: "A", viewedAt: 1 }];
		const { importLocalTrail } = useReadingHistory();
		expect(await importLocalTrail()).toBeNull();
		expect(importHistoryApi).not.toHaveBeenCalled();
	});

	it("importLocalTrail skips the API when the server already covers the whole device trail", async () => {
		authRef.value = true;
		localRecent.value = [{ slug: "a", title: "A", viewedAt: 10 }];
		fetchHistory.mockResolvedValue({
			items: [{ id: 1, title: "A", slug: "a", viewed_at: null }],
			total: 1,
			page: 1,
			limit: 100,
			total_pages: 1,
		});
		const { load, pendingDeviceCount, importLocalTrail } = useReadingHistory();
		await load();
		expect(pendingDeviceCount.value).toBe(0);
		expect(await importLocalTrail()).toEqual({ imported: 0, skipped: 0 });
		expect(importHistoryApi).not.toHaveBeenCalled();
	});

	it("guest history can be filtered in place by title (recall search, DEC-148)", async () => {
		localRecent.value = [
			{ slug: "a", title: "Alpha", viewedAt: 1 },
			{ slug: "b", title: "Beta", viewedAt: 2 },
		];
		const { load, history } = useReadingHistory();
		await load("alp");
		expect(history.value).toEqual([{ slug: "a", title: "Alpha", viewedAt: 1 }]);
		expect(fetchHistory).not.toHaveBeenCalled();
	});

	it("a non-parseable viewed_at maps to undefined instead of crashing (toEpoch guard)", async () => {
		authRef.value = true;
		fetchHistory.mockResolvedValue({
			items: [{ id: 1, title: "Garbage", slug: "g", viewed_at: "not-a-date" }],
			total: 1,
			page: 1,
			limit: 100,
			total_pages: 1,
		});
		const { load, history } = useReadingHistory();
		await load();
		expect(history.value[0]).toEqual({ slug: "g", title: "Garbage", viewedAt: undefined });
	});

	it("hasMore is false for guests (the local trail is bounded)", async () => {
		localRecent.value = [{ slug: "a", title: "A", viewedAt: 1 }];
		const { load, hasMore } = useReadingHistory();
		await load();
		expect(hasMore.value).toBe(false);
	});

	it("hasMore exposes whether an older server page still exists", async () => {
		authRef.value = true;
		fetchHistory.mockResolvedValueOnce({
			items: [{ id: 1, title: "A", slug: "a", viewed_at: null }],
			total: 1,
			page: 1,
			limit: 100,
			total_pages: 2,
		});
		fetchHistory.mockResolvedValueOnce({
			items: [{ id: 2, title: "B", slug: "b", viewed_at: null }],
			total: 2,
			page: 2,
			limit: 100,
			total_pages: 2,
		});
		const { load, loadMore, hasMore } = useReadingHistory();
		await load();
		expect(hasMore.value).toBe(true);
		await loadMore();
		expect(hasMore.value).toBe(false); // now on the last page
	});

	it("hasMore is false while a load is in flight", async () => {
		authRef.value = true;
		let resolveLoad!: (v: unknown) => void;
		fetchHistory.mockReturnValueOnce(new Promise((r) => (resolveLoad = r)));
		const { load, hasMore, loading } = useReadingHistory();
		const inFlight = load();
		expect(loading.value).toBe(true);
		expect(hasMore.value).toBe(false);
		resolveLoad({ items: [], total: 0, page: 1, limit: 100, total_pages: 1 });
		await inFlight;
	});

	it("a server load without an items payload yields an empty list", async () => {
		authRef.value = true;
		fetchHistory.mockResolvedValue({ total: 0, page: 1, limit: 100, total_pages: 1 });
		const { load, history } = useReadingHistory();
		await load();
		expect(history.value).toEqual([]);
	});

	it("defaults streak/longest/activity to 0/[] when the server omits them", async () => {
		authRef.value = true;
		fetchHistory.mockResolvedValue({ items: [], total: 0, page: 1, limit: 100, total_pages: 1 });
		fetchStats.mockResolvedValue({ total_posts: 1, total_reading_minutes: 2 });
		const { load, stats } = useReadingHistory();
		await load();
		expect(stats.value).toMatchObject({
			totalPosts: 1,
			totalReadingMinutes: 2,
			currentStreak: 0,
			longestStreak: 0,
			activity: [],
		});
	});

	it("a stats fetch failure nulls the summary without failing the load", async () => {
		authRef.value = true;
		fetchHistory.mockResolvedValue({
			items: [{ id: 1, title: "A", slug: "a", viewed_at: null }],
			total: 1,
			page: 1,
			limit: 100,
			total_pages: 1,
		});
		fetchStats.mockRejectedValue(new Error("stats down"));
		const { load, stats, loading } = useReadingHistory();
		await load();
		expect(stats.value).toBeNull();
		expect(loading.value).toBe(false);
	});

	it("importLocalTrail maps a legacy entry with no timestamp to an undefined viewed_at", async () => {
		authRef.value = true;
		// A legacy local row predates viewedAt recording (no timestamp).
		localRecent.value = [{ slug: "c", title: "C" }];
		fetchHistory.mockResolvedValue({
			items: [{ id: 1, title: "A", slug: "a", viewed_at: null }],
			total: 1,
			page: 1,
			limit: 100,
			total_pages: 1,
		});
		importHistoryApi.mockResolvedValue({ imported: 1, skipped: 0 });
		const { load, importLocalTrail } = useReadingHistory();
		await load();
		await importLocalTrail();
		const sent = importHistoryApi.mock.calls[0][0] as { slug: string; viewed_at?: string }[];
		expect(sent).toHaveLength(1);
		expect(sent[0].slug).toBe("c");
		// Never fabricate a timestamp for a row that has none.
		expect(sent[0].viewed_at).toBeUndefined();
	});

	it("loadMore is a no-op for guests (the local trail is bounded)", async () => {
		localRecent.value = [{ slug: "a", title: "A", viewedAt: 1 }];
		const { load, loadMore, loadingMore } = useReadingHistory();
		await load();
		await loadMore();
		expect(loadingMore.value).toBe(false);
		expect(fetchHistory).not.toHaveBeenCalled();
	});

	it("loadMore is refused while a primary load is in flight", async () => {
		authRef.value = true;
		let resolveLoad!: (v: unknown) => void;
		fetchHistory.mockReturnValueOnce(new Promise((r) => (resolveLoad = r)));
		const { load, loadMore, loading, loadingMore } = useReadingHistory();
		const inFlight = load();
		expect(loading.value).toBe(true);
		await loadMore(); // loading → refused immediately
		expect(loadingMore.value).toBe(false);
		resolveLoad({ items: [], total: 0, page: 1, limit: 100, total_pages: 1 });
		await inFlight;
		expect(fetchHistory).toHaveBeenCalledTimes(1); // only the load
	});

	it("loadMore is refused past the last server page", async () => {
		authRef.value = true;
		fetchHistory.mockResolvedValue({
			items: [{ id: 1, title: "A", slug: "a", viewed_at: null }],
			total: 1,
			page: 1,
			limit: 100,
			total_pages: 1,
		});
		const { load, loadMore, hasMore } = useReadingHistory();
		await load();
		expect(hasMore.value).toBe(false);
		await loadMore(); // next (2) > totalPages (1) → return
		expect(fetchHistory).toHaveBeenCalledTimes(1);
	});

	it("loadMore appends the next page, deduping by slug across the boundary (ISS-303)", async () => {
		authRef.value = true;
		fetchHistory.mockResolvedValueOnce({
			items: [
				{ id: 1, title: "A", slug: "a", viewed_at: null },
				{ id: 2, title: "B", slug: "b", viewed_at: null },
			],
			total: 2,
			page: 1,
			limit: 100,
			total_pages: 2,
		});
		let resolveMore!: (v: unknown) => void;
		fetchHistory.mockImplementationOnce(() => new Promise((r) => (resolveMore = r)));
		const { load, loadMore, history, loadingMore, hasMore } = useReadingHistory();
		await load();
		expect(hasMore.value).toBe(true);

		const more = loadMore();
		expect(loadingMore.value).toBe(true);
		expect(hasMore.value).toBe(false); // loadingMore blocks hasMore
		resolveMore({
			items: [
				{ id: 2, title: "B", slug: "b", viewed_at: null }, // duplicate of page-1 row
				{ id: 3, title: "C", slug: "c", viewed_at: null },
			],
			total: 3,
			page: 2,
			limit: 100,
			total_pages: 2,
		});
		await more;
		// B is not double-rendered across the page boundary.
		expect(history.value.map((h) => h.slug)).toEqual(["a", "b", "c"]);
		// Reaching the last page turns hasMore off.
		expect(hasMore.value).toBe(false);
		expect(loadingMore.value).toBe(false);
	});

	it("loadMore tolerates a paging response missing items/page/total_pages", async () => {
		authRef.value = true;
		fetchHistory.mockResolvedValueOnce({
			items: [{ id: 1, title: "A", slug: "a", viewed_at: null }],
			total: 1,
			page: 1,
			limit: 100,
			total_pages: 2,
		});
		fetchHistory.mockResolvedValueOnce({ total: 1 }); // bare payload
		const { load, loadMore, history, loadingMore, hasMore } = useReadingHistory();
		await load();
		await loadMore();
		expect(history.value.map((h) => h.slug)).toEqual(["a"]); // nothing appended
		// page fell back to the computed next (2) so no more pages remain.
		expect(hasMore.value).toBe(false);
		expect(loadingMore.value).toBe(false);
	});

	it("a loadMore failure keeps the loaded rows and surfaces loadMoreError", async () => {
		authRef.value = true;
		fetchHistory.mockResolvedValueOnce({
			items: [{ id: 1, title: "A", slug: "a", viewed_at: null }],
			total: 1,
			page: 1,
			limit: 100,
			total_pages: 2,
		});
		fetchHistory.mockRejectedValueOnce(new Error("network"));
		const { load, loadMore, history, loadMoreError, loadingMore } = useReadingHistory();
		await load();
		await loadMore();
		expect(loadMoreError.value).toBe(true);
		expect(history.value.map((h) => h.slug)).toEqual(["a"]); // rows kept
		expect(loadingMore.value).toBe(false);
	});

	it("drops a stale loadMore response when a newer load supersedes it", async () => {
		authRef.value = true;
		fetchHistory.mockResolvedValueOnce({
			items: [{ id: 1, title: "A", slug: "a", viewed_at: null }],
			total: 1,
			page: 1,
			limit: 100,
			total_pages: 2,
		});
		let resolveMore!: (v: unknown) => void;
		fetchHistory.mockImplementationOnce(() => new Promise((r) => (resolveMore = r)));
		const { load, loadMore, history } = useReadingHistory();
		await load();
		const more = loadMore();
		// A newer search supersedes the in-flight pager request.
		fetchHistory.mockResolvedValueOnce({
			items: [{ id: 2, title: "B", slug: "b", viewed_at: null }],
			total: 1,
			page: 1,
			limit: 100,
			total_pages: 1,
		});
		await load("b");
		resolveMore({
			items: [{ id: 3, title: "C", slug: "c", viewed_at: null }],
			total: 2,
			page: 2,
			limit: 100,
			total_pages: 2,
		});
		await more;
		// The stale page-2 rows must not append over the newer search.
		expect(history.value.map((h) => h.slug)).toEqual(["b"]);
	});

	it("a stale loadMore rejection does not surface an error", async () => {
		authRef.value = true;
		fetchHistory.mockResolvedValueOnce({
			items: [{ id: 1, title: "A", slug: "a", viewed_at: null }],
			total: 1,
			page: 1,
			limit: 100,
			total_pages: 2,
		});
		let rejectMore!: (v: unknown) => void;
		fetchHistory.mockImplementationOnce(() => new Promise((_, rj) => (rejectMore = rj)));
		const { load, loadMore, history, loadMoreError } = useReadingHistory();
		await load();
		const more = loadMore();
		// Supersede before the pager request settles.
		fetchHistory.mockResolvedValueOnce({
			items: [],
			total: 0,
			page: 1,
			limit: 100,
			total_pages: 1,
		});
		await load("x");
		rejectMore(new Error("stale network"));
		await more;
		expect(loadMoreError.value).toBe(false);
		expect(history.value).toEqual([]);
	});

	it("a stale history rejection cannot clobber a newer search (ISS-128 catch guard)", async () => {
		authRef.value = true;
		localRecent.value = [{ slug: "l", title: "Local", viewedAt: 5 }];
		let rejectHistory!: (v: unknown) => void;
		fetchHistory.mockImplementationOnce(() => new Promise((_, rj) => (rejectHistory = rj)));
		const { load, history, loadFailed } = useReadingHistory();
		const first = load("a");
		// Newer search succeeds.
		fetchHistory.mockResolvedValue({
			items: [{ id: 2, title: "New", slug: "new", viewed_at: null }],
			total: 1,
			page: 1,
			limit: 100,
			total_pages: 1,
		});
		await load("ab");
		expect(history.value[0]?.title).toBe("New");
		// The stale first request now fails — its rejection must be dropped, not
		// flip loadFailed for the list the reader is actually looking at.
		rejectHistory(new Error("stale network"));
		await first;
		expect(loadFailed.value).toBe(false);
		expect(history.value[0]?.title).toBe("New");
	});

	it("a stale stats response cannot overwrite a newer one", async () => {
		authRef.value = true;
		fetchHistory.mockResolvedValueOnce({
			items: [{ id: 1, title: "A", slug: "a", viewed_at: null }],
			total: 1,
			page: 1,
			limit: 100,
			total_pages: 1,
		});
		let resolveStats!: (v: unknown) => void;
		fetchStats.mockImplementationOnce(() => new Promise((r) => (resolveStats = r)));
		const { load, stats } = useReadingHistory();
		const first = load();
		// Let the FIRST load reach its stats fetch and park on the held promise —
		// otherwise the second load would consume it and this test would instead
		// be racing the first load's history seq-guard.
		await flushPromises();
		// Newer load resolves its stats immediately.
		fetchHistory.mockResolvedValue({
			items: [{ id: 2, title: "B", slug: "b", viewed_at: null }],
			total: 1,
			page: 1,
			limit: 100,
			total_pages: 1,
		});
		fetchStats.mockResolvedValueOnce({ total_posts: 9, total_reading_minutes: 1 });
		await load("b");
		expect(stats.value?.totalPosts).toBe(9);
		// The first (stale) stats response with the OLD numbers resolves last.
		resolveStats({ total_posts: 1, total_reading_minutes: 2 });
		await first;
		expect(stats.value?.totalPosts).toBe(9); // stale stats dropped
	});

	it("a stale stats rejection does not surface into the current state", async () => {
		authRef.value = true;
		fetchHistory.mockResolvedValueOnce({
			items: [{ id: 1, title: "A", slug: "a", viewed_at: null }],
			total: 1,
			page: 1,
			limit: 100,
			total_pages: 1,
		});
		let rejectStats!: (v: unknown) => void;
		fetchStats.mockImplementationOnce(() => new Promise((_, rj) => (rejectStats = rj)));
		const { load, stats } = useReadingHistory();
		const first = load();
		await flushPromises(); // first load parks on the (soon-to-be) stale stats fetch
		fetchHistory.mockResolvedValue({
			items: [{ id: 2, title: "B", slug: "b", viewed_at: null }],
			total: 1,
			page: 1,
			limit: 100,
			total_pages: 1,
		});
		fetchStats.mockResolvedValueOnce({ total_posts: 9, total_reading_minutes: 1 });
		await load("b");
		expect(stats.value?.totalPosts).toBe(9);
		rejectStats(new Error("stale stats down"));
		await first;
		// The stale rejection must not null the summary for the current list.
		expect(stats.value?.totalPosts).toBe(9);
	});

	it("clear() reports a server-side clear failure and still wipes the local mirror (ISS-387)", async () => {
		authRef.value = true;
		clearHistoryApi.mockRejectedValue(new Error("network"));
		const { load, clear, history, stats, loadFailed } = useReadingHistory();
		await load();
		expect(await clear()).toBe(false); // the server copy survived
		expect(localClear).toHaveBeenCalled();
		expect(history.value).toEqual([]);
		expect(stats.value).toBeNull();
		expect(loadFailed.value).toBe(false);
	});
});
