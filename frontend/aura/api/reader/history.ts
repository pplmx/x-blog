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
	/** Consecutive active days ending today (or yesterday) — DEC-169. */
	current_streak?: number;
	/** Longest run of consecutive active days anywhere (DEC-169). */
	longest_streak?: number;
	/** Last 52 weeks of per-day read counts (UTC, ascending, zeros included). */
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
 * preserves an already-saved position; ``0`` clears it.
 */
export function recordReaderHistory(
	postId: number,
	scrollPosition?: number,
): Promise<{ post_id: number; already_existed: boolean }> {
	const body = scrollPosition !== undefined ? { scroll_position: scrollPosition } : undefined;
	return command<{ post_id: number; already_existed: boolean }>(
		`/api/reader/me/history/${postId}`,
		{
			method: "POST",
			headers: readerAuthHeaders(),
			body,
		},
	);
}

/** The reader's saved resume offset for a post, if any (DEC-167/TASK-200). */
export function getReaderReadingPosition(
	postId: number,
): Promise<{ post_id: number; scroll_position: number | null }> {
	return command<{ post_id: number; scroll_position: number | null }>(
		`/api/reader/me/history/${postId}`,
		{ headers: readerAuthHeaders() },
	);
}

/** Reader reading-summary stats derived from their history (requires reader token). */
export function getReaderHistoryStats(): Promise<ReaderHistoryStats> {
	return command<ReaderHistoryStats>("/api/reader/me/history/stats", {
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
