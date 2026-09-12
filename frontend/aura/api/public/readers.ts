import type { Comment } from "../contracts/shared";
import { command } from "../transport";

/** Public reader profile (DEC-294, TASK-376) — no email, no last-login. */
export interface ReaderPublicProfile {
	id: number;
	display_name: string | null;
	// Profile picture (DEC-299/TASK-378) — a public image URL, never PII.
	avatar_url: string | null;
	created_at: string | null;
}

/** A comment on a reader's profile, with the post it was left on (navigation). */
export interface ProfileComment extends Comment {
	post: { id: number; title: string; slug: string } | null;
}

export interface ReaderProfilePage {
	profile: ReaderPublicProfile;
	items: ProfileComment[];
	pagination: {
		total: number;
		page: number;
		limit: number;
		total_pages: number;
	};
}

/**
 * A reader's public homepage: profile + approved comments on publicly-visible
 * posts (GET /api/readers/{id}). Public, no auth. 404 for unknown readers.
 */
export function getReaderProfile(
	readerId: number,
	page = 1,
	limit = 20,
): Promise<ReaderProfilePage> {
	return command<ReaderProfilePage>(`/api/readers/${readerId}`, {
		query: { page, limit },
	});
}
