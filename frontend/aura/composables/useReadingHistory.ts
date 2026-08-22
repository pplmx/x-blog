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
import {
	clearReaderHistory,
	fetchReaderHistory,
	fetchReaderHistoryStats,
	type ReaderHistoryListResponse,
} from "./useApi";
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
}

/** HISTORY page limit pulled from the API (newest-first, single page). */
const HISTORY_FETCH_LIMIT = 100;

function toEpoch(viewedAt?: string | null): number | undefined {
	if (!viewedAt) return undefined;
	const ms = Date.parse(viewedAt);
	return Number.isNaN(ms) ? undefined : ms;
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

	/** Load history (+ stats) from the active source (server if signed in, else local). */
	async function load(): Promise<void> {
		if (!serverEnabled.value) {
			history.value = fromLocal(local.recent.value);
			stats.value = null;
			return;
		}
		loading.value = true;
		try {
			const res = await fetchReaderHistory(1, HISTORY_FETCH_LIMIT);
			const data = res.data?.value as ReaderHistoryListResponse | undefined;
			history.value = (data?.items ?? []).map((i) => ({
				slug: i.slug,
				title: i.title,
				viewedAt: toEpoch(i.viewed_at),
			}));
		} catch {
			// Best-effort: fall back to the local trail if the call fails.
			history.value = fromLocal(local.recent.value);
		}
		try {
			const sres = await fetchReaderHistoryStats();
			const sdata = sres.data?.value as
				| { total_posts: number; total_reading_minutes: number; last_viewed_at?: string | null }
				| undefined;
			if (sdata) {
				stats.value = {
					totalPosts: sdata.total_posts,
					totalReadingMinutes: sdata.total_reading_minutes,
					lastViewedAt: toEpoch(sdata.last_viewed_at),
				};
			}
		} catch {
			stats.value = null;
		} finally {
			loading.value = false;
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
	}

	return { history, stats, loading, serverEnabled, load, clear };
}
