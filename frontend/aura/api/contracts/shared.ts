export interface PaginationInfo {
	total: number;
	page: number;
	limit: number;
	total_pages: number;
}

/** Lightweight series reference embedded in a post payload. */
export interface SeriesBrief {
	id: number;
	title: string;
	slug: string;
}

export interface PostList {
	id: number;
	title: string;
	slug: string;
	excerpt: string | null;
	snippet?: string | null;
	published: boolean;
	pinned?: boolean;
	created_at: string;
	/** Scheduled publication time (backend PostList serializes it, RIL ISS-265);
	 *  null/absent for immediately-published posts. */
	publish_at?: string | null;
	views: number;
	likes: number;
	comment_count?: number;
	reading_time?: number;
	cover_image: string | null;
	category: { id: number; name: string } | null;
	tags: { id: number; name: string }[];
	series: SeriesBrief | null;
	series_order: number;
}

export interface PostListResponse {
	items: PostList[];
	pagination: PaginationInfo;
}

export interface Category {
	id: number;
	name: string;
	post_count?: number;
}

export interface Tag {
	id: number;
	name: string;
	post_count?: number;
}

export interface Comment {
	id: number;
	post_id: number;
	parent_id: number | null;
	nickname: string;
	content: string;
	is_approved: boolean;
	// Author reply from the moderation queue (DEC-192): renders the "author"
	// badge so readers can tell an official reply from a commenter's comment.
	is_author_reply?: boolean;
	likes: number;
	created_at: string;
	edited_at?: string | null;
	reader: { id: number; display_name: string | null } | null;
}
