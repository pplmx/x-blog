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

vi.mock("../../composables/useApi", () => ({
	fetchReaderHistory: (...a: unknown[]) => fetchHistory(...a),
	fetchReaderHistoryStats: (...a: unknown[]) => fetchStats(...a),
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

function apiResult(data: unknown) {
	return { data: { value: data } };
}

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
		fetchHistory.mockResolvedValue(
			apiResult({
				items: [
					{ id: 1, title: "Server A", slug: "s-a", viewed_at: "2024-01-15T10:30:00Z" },
					{ id: 2, title: "Server B", slug: "s-b", viewed_at: null },
				],
				total: 2,
				page: 1,
				limit: 100,
				total_pages: 1,
			}),
		);
		const { load, history } = useReadingHistory();
		await load();
		expect(fetchHistory).toHaveBeenCalledWith(1, 100);
		expect(history.value[0]).toEqual({
			slug: "s-a",
			title: "Server A",
			viewedAt: Date.parse("2024-01-15T10:30:00Z"),
		});
		expect(history.value[1]).toEqual({ slug: "s-b", title: "Server B", viewedAt: undefined });
	});

	it("falls back to the local trail when the API call fails", async () => {
		authRef.value = true;
		localRecent.value = [{ slug: "l", title: "Local", viewedAt: 5 }];
		fetchHistory.mockRejectedValue(new Error("network"));
		const { load, history } = useReadingHistory();
		await load();
		expect(history.value).toEqual([{ slug: "l", title: "Local", viewedAt: 5 }]);
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
		fetchHistory.mockResolvedValue(apiResult({ items: [], total: 0 }));
		fetchStats.mockResolvedValue(
			apiResult({ total_posts: 1, total_reading_minutes: 2, recent: [] }),
		);
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
});
