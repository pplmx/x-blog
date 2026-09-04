/**
 * useReadingHistory composable tests (DEC-116, TASK-170).
 *
 * The history source follows the reader: a signed-in reader loads/clears the
 * server-backed trail (cross-device), while guests use the local localStorage
 * trail. Server fetch failures fall back to the local trail.
 */

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

vi.mock("~~/api/reader/history", () => ({
	getReaderHistory: (...a: unknown[]) => fetchHistory(...a),
	getReaderHistoryStats: (...a: unknown[]) => fetchStats(...a),
	clearReaderHistory: (...a: unknown[]) => clearHistoryApi(...a),
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
});
