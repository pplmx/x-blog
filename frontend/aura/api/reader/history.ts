import { readerAuthHeaders } from "../auth";
import type { PostList } from "../contracts/shared";
import { command, query } from "../transport";

/** One history item — a viewed post summary plus when it was last read. */
export interface ReaderHistoryItem {
	id: number;
	title: string;
	slug: string;
	excerpt?: string | null;
	viewed_at?: string | null;
}

export interface ReaderHistoryListResponse {
	items: ReaderHistoryItem[];
	total: number;
	page: number;
	limit: number;
	total_pages: number;
}

export interface ReaderHistoryStats {
	total_posts: number;
	total_reading_minutes: number;
	last_viewed_at?: string | null;
	recent: ReaderHistoryItem[];
	/**
	 * Consecutive active days ending today (or yesterday) — DEC-169. Counted in
	 * the reader's local calendar when a timezone was sent, UTC otherwise
	 * (DEC-316).
	 */
	current_streak?: number;
	/** Longest run of consecutive active days anywhere (DEC-169). */
	longest_streak?: number;
	/**
	 * Last 52 weeks of per-day read counts (ascending, zeros included) — the
	 * dates are the reader's LOCAL calendar days when a timezone was sent, UTC
	 * otherwise (DEC-316/TASK-386).
	 */
	activity?: { date: string; count: number }[];
}

/** A signed-in reader's progress through a series (from their history). */
export interface SeriesProgress {
	series_slug: string;
	series_title: string;
	total: number;
	read_count: number;
	completed: boolean;
	read_post_ids: number[];
	next_slug: string | null;
}

/** Server-backed reading history list, newest-first (requires reader token). */
export function getReaderHistory(
	page = 1,
	limit = 50,
	q?: string,
): Promise<ReaderHistoryListResponse> {
	return command<ReaderHistoryListResponse>("/api/reader/me/history", {
		query: { page, limit, q: q?.trim() || undefined },
		headers: readerAuthHeaders(),
	});
}

/**
 * Record a view on a post (idempotent upsert; requires reader token).
 *
 * Fire-and-forget client POST from the post page's onMounted — must run through
 * the imperative `command` seam, never `useFetch`: `useFetch` requires a
 * setup/suspense context to trigger execution and its request silently never
 * leaves the browser when called from a lifecycle hook. (ISS-110/111)
 *
 * ``scrollPosition`` (optional, DEC-167/TASK-200) saves the reader's resume
 * offset in one write with the same endpoint. Omit it for a plain view that
 * preserves an already-saved position; ``0`` clears it. ``scrollFraction``
 * (optional, DEC-346/TASK-399) is the same position as a 0..1 fraction of the
 * scrollable document height, so a cross-device continuation restores at the
 * right place on a differently-sized viewport.
 */
export function recordReaderHistory(
	postId: number,
	scrollPosition?: number,
	scrollFraction?: number,
): Promise<{ post_id: number; already_existed: boolean }> {
	const body =
		scrollPosition !== undefined
			? {
					scroll_position: scrollPosition,
					...(scrollFraction !== undefined ? { scroll_fraction: scrollFraction } : {}),
				}
			: undefined;
	return command<{ post_id: number; already_existed: boolean }>(
		`/api/reader/me/history/${postId}`,
		{
			method: "POST",
			headers: readerAuthHeaders(),
			body,
			// Fire-and-forget: the reader often leaves a post page immediately,
			// so keep the request alive across navigation instead of letting the
			// browser cancel it (a reload/back wipes an un-flushed record).
			keepalive: true,
		},
	);
}

/** The reader's saved resume offset for a post, if any (DEC-167/TASK-200);
 * ``scroll_fraction`` (DEC-346/TASK-399) is the cross-viewport fraction, null
 * for pre-feature rows. */
export function getReaderReadingPosition(
	postId: number,
): Promise<{ post_id: number; scroll_position: number | null; scroll_fraction: number | null }> {
	return command<{
		post_id: number;
		scroll_position: number | null;
		scroll_fraction: number | null;
	}>(`/api/reader/me/history/${postId}`, { headers: readerAuthHeaders() });
}

/**
 * The reader's posts with a saved resume position, newest-first (DEC-348,
 * TASK-400) — the cross-device "Continue reading" trail for the home page. The
 * home row was localStorage-only (DEC-104), invisible to a signed-in reader on
 * a NEW device; this surfaces the server trail (DEC-167/DEC-346) outside
 * /history. Imperative seam — a lifecycle-hook loader must never run a useFetch
 * query (ISS-110/111/117/118).
 */
export function getReaderInProgress(limit = 6): Promise<ReaderHistoryListResponse> {
	return command<ReaderHistoryListResponse>("/api/reader/me/history/in-progress", {
		query: { limit },
		headers: readerAuthHeaders(),
	});
}

/**
 * Reader reading-summary stats derived from their history (requires reader token).
 *
 * ``tz`` (optional, DEC-316/TASK-386) is the browser's IANA timezone id, e.g.
 * ``Asia/Shanghai``. The backend buckets the streak and 52-week heatmap to the
 * reader's own calendar when it is sent — without it the two aggregate in UTC
 * and silently disagree with a non-UTC reader's wall clock.
 */
export function getReaderHistoryStats(tz?: string): Promise<ReaderHistoryStats> {
	return command<ReaderHistoryStats>("/api/reader/me/history/stats", {
		query: { tz: tz?.trim() || undefined },
		headers: readerAuthHeaders(),
	});
}

/** A category name plus how many distinct posts of it the reader has read
 *  (DEC-417/TASK-434). */
export interface CategoryReadCount {
	name: string;
	count: number;
}

export interface ReaderHistoryInsights {
	/** Distinct publicly-visible posts the reader has read, all-time. */
	grand_total: number;
	/** Distinct publicly-visible posts read in the trailing 30 days. */
	last_30_days: number;
	/** Most-read categories by distinct post count (top 5). */
	top_categories: CategoryReadCount[];
}

/** Aggregated reading insights — what and how much the reader has read
 *  (DEC-417/TASK-434): distinct publicly-visible posts all-time and in the
 *  trailing 30 days, plus the most-read categories. Complements the
 *  streak/heatmap stats with the content shape. Requires reader token. */
export function getReaderHistoryInsights(): Promise<ReaderHistoryInsights> {
	return command<ReaderHistoryInsights>("/api/reader/me/history/insights", {
		headers: readerAuthHeaders(),
	});
}

/** Clear the reader's entire reading history (requires reader token). */
export function clearReaderHistory(): Promise<null> {
	return command<null>("/api/reader/me/history", {
		method: "DELETE",
		headers: readerAuthHeaders(),
	});
}

/** One device-local read to merge into the server history (TASK-303). */
export interface HistoryImportItem {
	slug: string;
	/** The guest's original read instant as naive-UTC ISO; legacy rows omit it. */
	viewed_at?: string;
}

export interface HistoryImportResult {
	imported: number;
	skipped: number;
}

/**
 * Merge the on-device reading trail into the server history (TASK-303, ISS-386).
 *
 * Guests record reads to localStorage; after sign-in the history source is the
 * server trail, so the device records silently vanish unless migrated. The
 * backend merges by post slug — idempotent, preserves each record's original
 * read instant, and only ever imports publicly visible posts. Requires the
 * reader token; the global cache middleware defaults it to no-store.
 */
export function importReaderHistory(items: HistoryImportItem[]): Promise<HistoryImportResult> {
	return command<HistoryImportResult>("/api/reader/me/history/import", {
		method: "POST",
		headers: readerAuthHeaders(),
		body: { items },
	});
}

/**
 * Personalized "Recommended for you" list (DEC-128, TASK-176).
 * Returns posts scored from the signed-in reader's history/bookmark affinity.
 */
export function useReaderRecommendations(limit = 6) {
	return query<PostList[]>("/api/reader/me/recommendations", {
		query: { limit },
		headers: readerAuthHeaders(),
		server: false,
	});
}

/**
 * Imperative "Recommended for you" list (home page onMounted loader) — the
 * imperative seam; see getReaderSeriesProgress for why lifecycle-hook loaders
 * must never run a useFetch query (ISS-110/111/117/118/119, TASK-220).
 */
export function getReaderRecommendations(limit = 6): Promise<PostList[]> {
	return command<PostList[]>("/api/reader/me/recommendations", {
		query: { limit },
		headers: readerAuthHeaders(),
	});
}

/** Reactive per-series progress read from the signed-in reader's history. */
export function useReaderSeriesProgress(slug: string) {
	return query<SeriesProgress>(`/api/reader/me/series/${slug}/progress`, {
		headers: readerAuthHeaders(),
		server: false,
	});
}

/**
 * Imperative per-series progress ($fetch seam, see getReaderSeriesFollows): a
 * lifecycle-hook loader must never run a useFetch query, which silently never
 * sends outside an async-setup context (ISS-110/111/117/118, TASK-220).
 */
export function getReaderSeriesProgress(slug: string): Promise<SeriesProgress> {
	return command<SeriesProgress>(`/api/reader/me/series/${slug}/progress`, {
		headers: readerAuthHeaders(),
	});
}
