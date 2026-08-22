/**
 * Reading-history source selector (DEC-116, TASK-170).
 *
 * A signed-in reader's Continue-reading trail is server-backed so it follows
 * them across devices; guests keep the client-side localStorage trail
 * (DEC-104/TASK-169). This composable exposes one normalized `history` list
 * (slug/title/viewedAt) that comes from the API when authenticated and from
 * the local trail otherwise, plus `load()` and `clear()` that act on the
 * active source. View *recording* stays in the post page: it always updates
 * the local trail and, when signed in, syncs to the server via
 * `recordReaderHistory` (see posts/[slug].vue).
 */

import { computed, ref } from "vue";
import { clearReaderHistory, fetchReaderHistory, type ReaderHistoryListResponse } from "./useApi";
import { useReaderAuth } from "./useReaderAuth";
import { useRecentlyViewed } from "./useRecentlyViewed";

export interface HistoryEntry {
	slug: string;
	title: string;
	/** Epoch ms when the post was last viewed (undefined for legacy local rows). */
	viewedAt?: number;
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
	const loading = ref(false);

	/** Load the history from the active source (server if signed in, else local). */
	async function load(): Promise<void> {
		if (!serverEnabled.value) {
			history.value = fromLocal(local.recent.value);
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
		} finally {
			loading.value = false;
		}
	}

	/** Clear the history from the active source (server + local both cleared). */
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
	}

	return { history, loading, serverEnabled, load, clear };
}
