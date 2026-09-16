import type { Comment, PostListResponse } from "../contracts/shared";
import { command } from "../transport";

/** Public reader profile (DEC-294, TASK-376) — no email, no last-login. */
export interface ReaderPublicProfile {
	id: number;
	display_name: string | null;
	/** Reader-written "about me" (round 352) — plain text, null until set. */
	bio: string | null;
	// Profile picture (DEC-299/TASK-378) — a public image URL, never PII.
	avatar_url: string | null;
	/** Opt-in public "Liked posts" tab (round 360, DEC-393): when true the
	 *  profile may render a Likes tab fed by getReaderPublicLikes; false for
	 *  readers who chose not to publish (their likes stay private). */
	public_likes: boolean;
	/** Opt-in public "Saved posts" tab (round 363, DEC-399): when true the
	 *  profile may render a Saved tab fed by getReaderPublicBookmarks; false
	 *  for readers who chose not to publish their curated reading list. */
	public_bookmarks: boolean;
	/** How many readers follow this one (round 365, DEC-403) — public, like an
	 *  author-follow count; every visitor sees it in the profile header. */
	follower_count: number;
	/** The SIGNED-IN caller's own stance (round 365): true when the caller
	 *  follows this reader, always false for guests — the header renders the
	 *  Follow/Following button off this. Not an oracle for anyone else. */
	is_following: boolean;
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

/**
 * A reader's published liked posts (GET /api/readers/{id}/likes, round 360).
 * Public like the profile — anyone can browse a reader who opted in to the
 * "Liked posts" tab. 404 (undefined) for unknown readers OR readers who never
 * opted in: one indistinguishable answer, so the surface leaks neither whether
 * the reader exists nor what they like.
 */
export function getReaderPublicLikes(
	readerId: number,
	page = 1,
	limit = 20,
): Promise<PostListResponse | null> {
	return command<PostListResponse | null>(`/api/readers/${readerId}/likes`, {
		query: { page, limit },
	});
}

/**
 * A reader's published saved posts (GET /api/readers/{id}/bookmarks, round 363).
 * Public like the profile — anyone can browse a reader who opted in to the
 * "Saved posts" tab (their curated reading list, an intentional signal).
 * 404 (undefined) for unknown readers OR readers who never opted in: one
 * indistinguishable answer, so the surface leaks neither whether the reader
 * exists nor what they saved.
 */
export function getReaderPublicBookmarks(
	readerId: number,
	page = 1,
	limit = 20,
): Promise<PostListResponse | null> {
	return command<PostListResponse | null>(`/api/readers/${readerId}/bookmarks`, {
		query: { page, limit },
	});
}

/** One '@'-mention picker suggestion — public identity only (never email). */
export interface ReaderMentionSuggestion {
	id: number;
	display_name: string;
	// Profile picture (DEC-299/TASK-378) — a public image URL, never PII.
	avatar_url: string | null;
}

/**
 * Reader suggestions for the comment box's '@' picker (GET /api/readers/suggest).
 * Public like the profile route: active readers whose display name matches the
 * query, case-insensitive and prefix-ranked, bounded server-side. (DEC-324,
 * TASK-390)
 */
export function suggestMentionReaders(query: string): Promise<ReaderMentionSuggestion[]> {
	return command<ReaderMentionSuggestion[]>("/api/readers/suggest", {
		query: { query },
	});
}
