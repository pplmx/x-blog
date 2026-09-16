import { type Ref, unref } from "vue";
import type { AuthorArchive, PostListResponse } from "../contracts/shared";
import {
	type ApiQueryOptions,
	type ApiQueryPath,
	type QueryParams,
	query,
	withQuery,
} from "../transport";

type Getter<T> = () => T;
type MaybeGetter<T> = T | Getter<T> | Ref<T>;

/** A public author's archive (DEC-359/TASK-405): the author envelope rides on
 *  the (possibly empty) post list so the page can title itself by pen name
 *  even before the writer has published anything. The envelope carries the
 *  archive-shaped author — AuthorArchive (round 357) — with the "about this
 *  writer" bio; per-post lists keep the slim AuthorBrief. */
export interface AuthorPostsResponse extends PostListResponse {
	author?: AuthorArchive | null;
}

/** A writers-index row (rounds 346/357): pen name + published-post count +
 *  the public "about this writer" bio (null until a superuser writes one). */
export interface AuthorIndex {
	id: number;
	display_name: string;
	post_count: number;
	bio?: string | null;
}

/** Every public writer, pen name + published-post count (round 346) — powers
 *  the /authors index page. Anonymous + caching-friendly. */
export function useAuthors() {
	return query<AuthorIndex[]>("/api/authors");
}

export interface AuthorPostFilters {
	page?: number;
	limit?: number;
}

/** A writer's published posts, newest-first (paginated).
 *
 * The backend answers 404 for unknown ids and for admins with no pen name (no
 * public presence — the username never surfaces), so a 404 here IS the page's
 * "author not found" signal. Pass a getter so useFetch refetches on SPA
 * navigation between authors.
 */
export function useAuthorPosts(
	authorId: string | number | Getter<string | number | null | undefined>,
	filters: MaybeGetter<AuthorPostFilters> = {},
	options: ApiQueryOptions<AuthorPostsResponse> = {},
) {
	const path = (() => {
		const id = typeof authorId === "function" ? authorId() : unref(authorId);
		if (id == null) return null;
		// AuthorPostFilters is structurally a QueryParams superset; the cast
		// keeps the caller-facing type precise while withQuery works on the
		// generic record (same cast as usePosts' filters).
		const params = (typeof filters === "function" ? filters() : unref(filters)) as QueryParams;
		return withQuery(`/api/authors/${id}/posts`, params);
	}) as ApiQueryPath;
	return query<AuthorPostsResponse>(path, options);
}
