/**
 * Reading-history source selector + summary (DEC-116/TASK-170, DEC-118/TASK-171).
 *
 * A signed-in reader's Continue-reading trail is server-backed so it follows
 * them across devices; guests keep the client-side localStorage trail
 * (DEC-104/TASK-169). This composable exposes one normalized `history` list
 * (slug/title/viewedAt) from the API when authenticated and from the local
 * trail otherwise, plus `load()`/`clear()` on the active source. For signed-in
 * readers it also loads a `stats` summary (posts read, total reading minutes,
 * last viewed) so /history can render the reading-summary cards. View
 * *recording* stays in the post page: it always updates the local trail and,
 * when signed in, syncs to the server via `recordReaderHistory`.
 */

import { computed, ref } from "vue";
import { clearReaderHistory, getReaderHistory, getReaderHistoryStats } from "~~/api/reader/history";
import { parseApiDate } from "./apiDate";
import { useReaderAuth } from "./useReaderAuth";
import { useRecentlyViewed } from "./useRecentlyViewed";

export interface HistoryEntry {
	slug: string;
	title: string;
	/** Epoch ms when the post was last viewed (undefined for legacy local rows). */
	viewedAt?: number;
}

export interface ReadingStats {
	totalPosts: number;
	totalReadingMinutes: number;
	/** Epoch ms of the most recent view (server-only; undefined for guests). */
	lastViewedAt?: number;
	/** Consecutive active days (server-only; 0 for guests). DEC-169/TASK-201. */
	currentStreak?: number;
	/** Longest run of consecutive active days (server-only). DEC-169/TASK-201. */
	longestStreak?: number;
	/** Last 52 weeks of per-day read counts (server-only). DEC-169/TASK-201. */
	activity?: { date: string; count: number }[];
}

/** HISTORY page limit pulled from the API (newest-first, single page). */
const HISTORY_FETCH_LIMIT = 100;

function toEpoch(viewedAt?: string | null): number | undefined {
	if (!viewedAt) return undefined;
	// The server sends viewed_at as naive UTC (no zone marker); Date.parse would
	// read it as the browser's LOCAL wall-clock and shift the displayed instant
	// by the reader's UTC offset (deep-dive finding). parseApiDate asserts "Z".
	const d = parseApiDate(viewedAt);
	return d ? d.getTime() : undefined;
}

function fromLocal(items: { slug: string; title: string; viewedAt?: number }[]): HistoryEntry[] {
	return items.map((x) => ({ slug: x.slug, title: x.title, viewedAt: x.viewedAt }));
}

export function useReadingHistory() {
	const { isAuthenticated } = useReaderAuth();
	const local = useRecentlyViewed();

	const serverEnabled = computed(() => isAuthenticated.value);
	const history = ref<HistoryEntry[]>([]);
	const stats = ref<ReadingStats | null>(null);
	const loading = ref(false);
	// True when the last SERVER load failed and history fell back to the local
	// trail. The /history page renders a labeled fallback + retry off this so a
	// transient failure is never mistaken for "no reading history yet" (a
	// false-empty state for a multi-device reader with a mostly-empty local
	// trail, deep-dive finding).
	const loadFailed = ref(false);

	// Server-side paging (bounded reachability, RIL ISS-303): the API returns
	// at most HISTORY_FETCH_LIMIT rows per page, so a reader with more history
	// could never reach the older entries. load() resets to page 1; loadMore()
	// appends the next page. Guests use the bounded local trail and never page.
	const page = ref(1);
	const totalPages = ref(1);
	const loadingMore = ref(false);
	const loadMoreError = ref(false);
	const activeQuery = ref("");

	/** True while an older server page still exists (there is more to load). */
	const hasMore = computed(
		() =>
			serverEnabled.value && !loading.value && !loadingMore.value && page.value < totalPages.value,
	);

	// Monotonic request sequence so a slow earlier response cannot overwrite a
	// newer one after the recall-search query changed (ISS-128).
	let loadSeq = 0;

	/** Load history (+ stats) from the active source (server if signed in, else local).
	 * ``query`` (optional) filters to posts whose title/excerpt match (recall
	 * search, DEC-148/TASK-186): server asks the API, guests filter in place. */
	async function load(query = ""): Promise<void> {
		const seq = ++loadSeq; // invalidate any in-flight older request
		if (!serverEnabled.value) {
			const term = query.trim().toLowerCase();
			const all = fromLocal(local.recent.value);
			history.value = term ? all.filter((h) => h.title.toLowerCase().includes(term)) : all;
			stats.value = null;
			loadFailed.value = false;
			page.value = 1;
			totalPages.value = 1;
			// A sign-out mid-flight must still clear the spinner left by the
			// superseded server request (this load is now the latest).
			if (seq === loadSeq) loading.value = false;
			return;
		}
		activeQuery.value = query;
		page.value = 1;
		totalPages.value = 1;
		loading.value = true;
		try {
			const data = await getReaderHistory(1, HISTORY_FETCH_LIMIT, query);
			if (seq !== loadSeq) return; // stale response — a newer search is in flight
			page.value = data?.page ?? 1;
			totalPages.value = data?.total_pages ?? 1;
			history.value = (data?.items ?? []).map((i) => ({
				slug: i.slug,
				title: i.title,
				viewedAt: toEpoch(i.viewed_at),
			}));
			loadFailed.value = false;
		} catch {
			if (seq !== loadSeq) return;
			// Best-effort: fall back to the local trail if the call fails, but
			// flag it so the page labels the fallback instead of presenting a
			// false "no history yet" empty state.
			loadFailed.value = true;
			history.value = fromLocal(local.recent.value);
		}
		try {
			const sdata = await getReaderHistoryStats();
			if (seq !== loadSeq) return;
			if (sdata) {
				stats.value = {
					totalPosts: sdata.total_posts,
					totalReadingMinutes: sdata.total_reading_minutes,
					lastViewedAt: toEpoch(sdata.last_viewed_at),
					currentStreak: sdata.current_streak ?? 0,
					longestStreak: sdata.longest_streak ?? 0,
					activity: sdata.activity ?? [],
				};
			}
		} catch {
			if (seq !== loadSeq) return;
			stats.value = null;
		} finally {
			// Only the latest request may clear the spinner.
			if (seq === loadSeq) loading.value = false;
		}
	}

	/**
	 * Append the next server page of history (bounded reachability, ISS-303).
	 * Dedupes by slug so a page boundary can never double-render a row; a
	 * failure keeps the rows already shown and surfaces a retry hint. Guests
	 * never page (the local trail is bounded).
	 */
	async function loadMore(): Promise<void> {
		if (!serverEnabled.value || loading.value || loadingMore.value) return;
		const next = page.value + 1;
		if (next > totalPages.value) return;
		loadingMore.value = true;
		loadMoreError.value = false;
		const seq = ++loadSeq;
		try {
			const data = await getReaderHistory(next, HISTORY_FETCH_LIMIT, activeQuery.value);
			if (seq !== loadSeq) return;
			const seen = new Set(history.value.map((h) => h.slug));
			const fresh = (data?.items ?? [])
				.map((i) => ({
					slug: i.slug,
					title: i.title,
					viewedAt: toEpoch(i.viewed_at),
				}))
				.filter((h) => !seen.has(h.slug));
			history.value = [...history.value, ...fresh];
			page.value = data?.page ?? next;
			totalPages.value = data?.total_pages ?? totalPages.value;
		} catch {
			if (seq !== loadSeq) return;
			loadMoreError.value = true;
		} finally {
			if (seq === loadSeq) loadingMore.value = false;
		}
	}

	/** Clear the history (and stats) from the active source (server + local both cleared). */
	async function clear(): Promise<void> {
		if (serverEnabled.value) {
			try {
				await clearReaderHistory();
			} catch {
				// Best-effort: still clear the local mirror even if the API call fails.
			}
		}
		local.clear();
		history.value = [];
		stats.value = null;
		// Clear the failure flag too: after clearing the (fallback) trail a stale
		// banner would otherwise keep hiding the legitimate empty state while
		// claiming "showing this device's records" for a list that is now empty.
		loadFailed.value = false;
		page.value = 1;
		totalPages.value = 1;
	}

	return {
		history,
		stats,
		loading,
		loadFailed,
		serverEnabled,
		hasMore,
		loadingMore,
		loadMoreError,
		load,
		loadMore,
		clear,
	};
}
