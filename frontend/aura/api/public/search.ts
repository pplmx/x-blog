import { type Ref, unref } from "vue";
import type { Comment } from "../contracts/shared";
import { type ApiQueryOptions, type QueryParams, query, withQuery } from "../transport";

type Getter<T> = () => T;
type MaybeGetter<T> = T | Getter<T> | Ref<T>;

/**
 * One comment search hit (round 366, DEC-405): the public comment shape plus
 * a mark-safe highlighted snippet and the post brief, so a result can land ON
 * the comment (#comment-{id}, DEC-321) instead of just the post headline.
 * Never carries the email or IP (the Comment contract omits both).
 */
export interface CommentSearchItem extends Comment {
	/** Backend-built highlighted excerpt (escaped before <mark>, safe). */
	snippet?: string | null;
	/** The post the comment lives on (null only for a broken/removed post). */
	post: { id: number; title: string; slug: string } | null;
}

export interface CommentSearchResponse {
	items: CommentSearchItem[];
	pagination: {
		page: number;
		limit: number;
		total: number;
		total_pages: number;
	};
}

export interface CommentSearchParams {
	q?: string;
	page?: number;
	limit?: number;
}

function queryPath(path: string, params: MaybeGetter<QueryParams>): string | Getter<string> {
	if (typeof params === "function") return () => withQuery(path, params());
	return () => withQuery(path, unref(params));
}

/**
 * Reactive comment search (GET /api/search/comments, round 366 / DEC-405).
 *
 * Finds approved comments on publicly-visible posts by content, newest first,
 * each with a highlighted snippet + the post brief. Same URL-reactive contract
 * as usePostSearch: pass a computed params object and the query refetches
 * when q/page change, and gate with `enabled` when there is nothing to search.
 * Used by /search's ?type=comments mode.
 */
export function useCommentSearch(
	params: MaybeGetter<CommentSearchParams>,
	options: ApiQueryOptions<CommentSearchResponse> = {},
) {
	return query<CommentSearchResponse>(
		queryPath("/api/search/comments", params as MaybeGetter<QueryParams>),
		options,
	);
}
