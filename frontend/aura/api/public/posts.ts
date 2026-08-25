import { type Ref, unref } from "vue";
import type { PostList, PostListResponse } from "../contracts/shared";
import {
	type ApiQueryOptions,
	type ApiQueryPath,
	command,
	type QueryParams,
	query,
	withQuery,
} from "../transport";

type Getter<T> = () => T;
type MaybeGetter<T> = T | Getter<T> | Ref<T>;

export interface ArchiveEntry {
	year: number;
	month: number;
	count: number;
}

export interface Post extends PostList {
	content: string;
	likes: number;
	updated_at: string;
}

export interface AdjacentPosts {
	previous: PostList | null;
	next: PostList | null;
}

export interface PostFilters {
	category_id?: number;
	tag_id?: number;
	year?: number;
	month?: number;
	page?: number;
	limit?: number;
}

export interface PostSearchParams {
	q?: string;
	category?: string;
	tag?: string;
	sort?: string;
	date_from?: string;
	date_to?: string;
	page?: number;
	limit?: number;
}

function queryPath(path: string, params: MaybeGetter<QueryParams>): string | Getter<string> {
	if (typeof params === "function") return () => withQuery(path, params());
	return () => withQuery(path, unref(params));
}

function optionalResourcePath(
	basePath: string,
	value: Getter<string | number | null | undefined>,
	suffix = "",
): ApiQueryPath {
	return (() => {
		const resolved = value();
		return resolved ? `${basePath}/${resolved}${suffix}` : null;
	}) as ApiQueryPath;
}

export function usePosts(
	filters: MaybeGetter<PostFilters> = {},
	options: ApiQueryOptions<PostListResponse> = {},
) {
	// PostFilters is structurally a QueryParams superset; the cast keeps the
	// caller-facing type precise while queryPath works on the generic record.
	return query<PostListResponse>(
		queryPath("/api/posts", filters as MaybeGetter<QueryParams>),
		options,
	);
}

export function usePost(
	slugOrId: string | number | Getter<string | number>,
	options: ApiQueryOptions<Post> = {},
) {
	const path =
		typeof slugOrId === "function" ? () => `/api/posts/${slugOrId()}` : `/api/posts/${slugOrId}`;
	return query<Post>(path, options);
}

export function usePostSearch(
	params: MaybeGetter<PostSearchParams>,
	options: ApiQueryOptions<PostListResponse> = {},
) {
	return query<PostListResponse>(
		queryPath("/api/search", params as MaybeGetter<QueryParams>),
		options,
	);
}

export function usePostArchive(options: ApiQueryOptions<ArchiveEntry[]> = {}) {
	return query<ArchiveEntry[]>("/api/posts/archive", options);
}

export function recordPostView(postId: number): Promise<Post> {
	return command<Post>(`/api/posts/${postId}/view`, { method: "POST" });
}

export function likePost(postId: number): Promise<Post> {
	return command<Post>(`/api/posts/${postId}/like`, { method: "POST" });
}

export function usePopularPosts(limit = 5) {
	return query<PostList[]>("/api/posts/popular/list", { query: { limit } });
}

export function useRelatedPosts(postId: number | Getter<number | null | undefined>, limit = 5) {
	const path =
		typeof postId === "function"
			? optionalResourcePath("/api/posts", postId, "/related")
			: `/api/posts/${postId}/related`;
	return query<PostList[]>(path, { query: { limit } });
}

export function useAdjacentPosts(postId: number | Getter<number | null | undefined>) {
	const path =
		typeof postId === "function"
			? optionalResourcePath("/api/posts", postId, "/adjacent")
			: `/api/posts/${postId}/adjacent`;
	return query<AdjacentPosts>(path);
}
