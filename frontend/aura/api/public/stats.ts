import { query } from "../transport";

export interface BlogStats {
	total_posts: number;
	published_posts: number;
	scheduled_posts: number;
	total_categories: number;
	total_tags: number;
	total_comments: number;
	pending_comments: number;
	total_views: number;
	total_likes: number;
}

export function useBlogStats() {
	return query<BlogStats>("/api/stats");
}
