import { readerAuthHeaders } from "../auth";
import { command, query } from "../transport";

/** A bookmarked post as serialized by GET /api/reader/me/bookmarks (TASK-132).
 * Mirrors the localStorage `Bookmark` shape (useBookmarks.ts) so both
 * serializations merge transparently on the client. */
export interface ReaderBookmarkItem {
	id: number;
	title: string;
	slug: string;
	excerpt: string | null;
	cover_image: string | null;
	created_at: string | null;
	folder_id?: number | null;
	folder_name?: string | null;
	/** Queue state (round 361, DEC-395): false = To-read, true = Done. */
	done?: boolean;
	category: { id: number; name: string } | null;
	tags: { id: number; name: string }[];
}

export interface ReaderBookmarkListResponse {
	items: ReaderBookmarkItem[];
	total: number;
	page?: number;
	limit?: number;
	total_pages?: number;
}

/** A reader's bookmark folder/collection (DEC-120, TASK-172). */
export interface BookmarkFolder {
	id: number;
	name: string;
	count: number;
}

export interface BookmarkFolderListResponse {
	items: BookmarkFolder[];
	total: number;
}

/** Reactive cloud-synced bookmarks list for setup usage (requires reader token);
 *  optional folder + done (queue-state) filter. */
export function useReaderBookmarks(options?: { folderId?: number | null; done?: boolean }) {
	return query<ReaderBookmarkListResponse>("/api/reader/me/bookmarks", {
		query: { folder_id: options?.folderId ?? undefined, done: options?.done },
		headers: readerAuthHeaders(),
		server: false,
	});
}

/** Imperative bookmarks list for merge/sync handlers that need the data directly.
 *  Bounded paging: pass ``page``/``limit`` to walk total_pages (ISS-142). */
export function getReaderBookmarks(
	folderId?: number | null,
	page?: number,
	limit?: number,
	done?: boolean,
): Promise<ReaderBookmarkListResponse> {
	return command<ReaderBookmarkListResponse>("/api/reader/me/bookmarks", {
		query: { folder_id: folderId ?? undefined, page, limit, done },
		headers: readerAuthHeaders(),
	});
}

/** Reactive bookmark folders list for setup usage (requires reader token). */
export function useReaderBookmarkFolders() {
	return query<BookmarkFolderListResponse>("/api/reader/me/bookmarks/folders", {
		headers: readerAuthHeaders(),
		server: false,
	});
}

/** Imperative bookmark folders list for handlers that need the data directly. */
export function getReaderBookmarkFolders(): Promise<BookmarkFolderListResponse> {
	return command<BookmarkFolderListResponse>("/api/reader/me/bookmarks/folders", {
		headers: readerAuthHeaders(),
	});
}

/** Create a bookmark folder (requires reader token). */
export function createReaderBookmarkFolder(name: string): Promise<{ id: number; name: string }> {
	return command<{ id: number; name: string }>("/api/reader/me/bookmarks/folders", {
		method: "POST",
		headers: { ...readerAuthHeaders(), "Content-Type": "application/json" },
		body: { name },
	});
}

/** Rename a bookmark folder (requires reader token). */
export function renameReaderBookmarkFolder(
	folderId: number,
	name: string,
): Promise<{ id: number; name: string }> {
	return command<{ id: number; name: string }>(`/api/reader/me/bookmarks/folders/${folderId}`, {
		method: "PATCH",
		headers: { ...readerAuthHeaders(), "Content-Type": "application/json" },
		body: { name },
	});
}

/** Delete a bookmark folder (requires reader token); bookmarks become uncategorized. */
export function deleteReaderBookmarkFolder(folderId: number): Promise<null> {
	return command<null>(`/api/reader/me/bookmarks/folders/${folderId}`, {
		method: "DELETE",
		headers: readerAuthHeaders(),
	});
}

/** File a bookmarked post into a folder (folderId null clears) — requires reader token. */
export function assignBookmarkFolder(
	postId: number,
	folderId: number | null,
): Promise<{ post_id: number; folder_id: number | null }> {
	return command<{ post_id: number; folder_id: number | null }>(
		`/api/reader/me/bookmarks/${postId}/folder`,
		{
			method: "PATCH",
			headers: { ...readerAuthHeaders(), "Content-Type": "application/json" },
			body: { folder_id: folderId },
		},
	);
}

/** Save a bookmark. Returns 201 (new) / 200 (already existed) — idempotent. */
export function addReaderBookmark(postId: number): Promise<{ post_id: number }> {
	return command<{ post_id: number }>(`/api/reader/me/bookmarks/${postId}`, {
		method: "PUT",
		headers: readerAuthHeaders(),
	});
}

/** Move a bookmark between To-read and Done (round 361, DEC-395). Idempotent;
 *  404 if the post isn't bookmarked by this reader. */
export function setBookmarkDone(
	postId: number,
	done: boolean,
): Promise<{ post_id: number; done: boolean }> {
	return command<{ post_id: number; done: boolean }>(`/api/reader/me/bookmarks/${postId}/done`, {
		method: "PATCH",
		headers: { ...readerAuthHeaders(), "Content-Type": "application/json" },
		body: { done },
	});
}

/** Remove a bookmark (204 no-op if absent). */
export function removeReaderBookmark(postId: number): Promise<null> {
	return command<null>(`/api/reader/me/bookmarks/${postId}`, {
		method: "DELETE",
		headers: readerAuthHeaders(),
	});
}

/** Delete every bookmark the reader has saved (204, idempotent). Called by the
 *  /bookmarks "Clear all" action so a signed-in clear sticks to the cloud too,
 *  not just the localStorage mirror (TASK-233). */
export function clearReaderBookmarks(): Promise<null> {
	return command<null>("/api/reader/me/bookmarks", {
		method: "DELETE",
		headers: readerAuthHeaders(),
	});
}
