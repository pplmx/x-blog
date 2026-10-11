import { readerAuthHeaders } from "../auth";
import { command, query } from "../transport";

/** The post a highlight belongs to (title/slug for deep-linking). */
export interface ReaderHighlightPost {
	id: number;
	slug: string;
	title: string;
}

/** A reader's saved passage (round 466, DEC-511 / TASK-583). */
export interface ReaderHighlight {
	id: number;
	post_id: number;
	text: string;
	note: string | null;
	created_at: string | null;
	post: ReaderHighlightPost | null;
}

export interface ReaderHighlightListResponse {
	items: ReaderHighlight[];
	total: number;
	page?: number;
	limit?: number;
	total_pages?: number;
}

/** Reactive list of the signed-in reader's highlights (newest first). */
export function useReaderHighlights(page = 1, limit = 50) {
	return query<ReaderHighlightListResponse>("/api/reader/me/highlights", {
		query: { page, limit },
		headers: readerAuthHeaders(),
		server: false,
	});
}

/** Imperative highlights list for handlers that need the data directly. */
export function getReaderHighlights(page = 1, limit = 50): Promise<ReaderHighlightListResponse> {
	return command<ReaderHighlightListResponse>("/api/reader/me/highlights", {
		query: { page, limit },
		headers: readerAuthHeaders(),
	});
}

/** Save a passage from a post (idempotent: returns 201/200 as already-existed). */
export function createReaderHighlight(
	postId: number,
	text: string,
	note?: string,
): Promise<ReaderHighlight> {
	return command<ReaderHighlight>("/api/reader/me/highlights", {
		method: "POST",
		headers: { ...readerAuthHeaders(), "Content-Type": "application/json" },
		body: { post_id: postId, text, note: note ?? undefined },
	});
}

/** Update a highlight's private note (owner-only). */
export function updateReaderHighlightNote(id: number, note: string): Promise<ReaderHighlight> {
	return command<ReaderHighlight>(`/api/reader/me/highlights/${id}`, {
		method: "PATCH",
		headers: { ...readerAuthHeaders(), "Content-Type": "application/json" },
		body: { note },
	});
}

/** Delete a highlight (idempotent 204; removes only the caller's own row). */
export function deleteReaderHighlight(id: number): Promise<null> {
	return command<null>(`/api/reader/me/highlights/${id}`, {
		method: "DELETE",
		headers: readerAuthHeaders(),
	});
}
