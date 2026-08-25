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

	/** Load history (+ stats) from the active source (server if signed in, else local).
	 * ``query`` (optional) filters to posts whose title/excerpt match (recall
	 * search, DEC-148/TASK-186): server asks the API, guests filter in place. */
	async function load(query = ""): Promise<void> {
		if (!serverEnabled.value) {
			const term = query.trim().toLowerCase();
			const all = fromLocal(local.recent.value);
			history.value = term ? all.filter((h) => h.title.toLowerCase().includes(term)) : all;
			stats.value = null;
			return;
		}
		loading.value = true;
		try {
			const data = await getReaderHistory(1, HISTORY_FETCH_LIMIT, query);
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
			const sdata = await getReaderHistoryStats();
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
