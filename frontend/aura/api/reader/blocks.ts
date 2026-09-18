import { readerAuthHeaders } from "../auth";
import { command } from "../transport";

/** One reader the signed-in reader has blocked (round 379, DEC-425). */
export interface BlockedReaderItem {
	reader_id: number;
	/** Public identity only — never the email; may be null when unset. */
	display_name: string | null;
	avatar_url: string | null;
	/** When the block was placed (management list ordering). */
	blocked_at: string | null;
}

export interface BlockedReaderListResponse {
	items: BlockedReaderItem[];
	total: number;
}

/**
 * GET /api/reader/me/blocks — the reader's own block list, newest first.
 * Reader-scoped (401 for guests/admin); the account page renders each row
 * with an unblock control.
 */
export function getBlockedReaders(): Promise<BlockedReaderListResponse> {
	return command<BlockedReaderListResponse>("/api/reader/me/blocks", {
		headers: readerAuthHeaders(),
	});
}

/**
 * PUT /api/reader/me/blocks/:id — block another reader. Idempotent (201/200);
 * never tells the blocked reader. Suppresses their mentions / replies /
 * thread-comments / follow-activity to this reader at every dispatch point.
 */
export function blockReader(readerId: number): Promise<BlockedReaderItem> {
	return command<BlockedReaderItem>(`/api/reader/me/blocks/${readerId}`, {
		method: "PUT",
		headers: readerAuthHeaders(),
	});
}

/** DELETE /api/reader/me/blocks/:id — unblock; idempotent 204. */
export function unblockReader(readerId: number): Promise<null> {
	return command<null>(`/api/reader/me/blocks/${readerId}`, {
		method: "DELETE",
		headers: readerAuthHeaders(),
	});
}
