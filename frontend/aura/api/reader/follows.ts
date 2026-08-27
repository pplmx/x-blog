import { readerAuthHeaders } from "../auth";
import type { PostList } from "../contracts/shared";
import { command, query } from "../transport";

/** The series the signed-in reader follows for new-part push. */
export interface FollowedSeriesItem {
	id: number;
	title: string;
	slug: string;
	description?: string | null;
	/** Whether new-part push is enabled for this follow (TASK-181). */
	notify: boolean;
}

export interface FollowedSeriesListResponse {
	items: FollowedSeriesItem[];
	total: number;
}

export interface SeriesFollowState {
	series_id: number;
	series_slug: string;
	following: boolean;
	notify: boolean;
}

/** The categories the signed-in reader follows (durable reader-level intent). */
export interface FollowedCategoryItem {
	id: number;
	name: string;
	/** Whether new-post push is enabled for this follow (TASK-182). */
	notify: boolean;
}

export interface FollowedCategoryListResponse {
	items: FollowedCategoryItem[];
	total: number;
}

export interface CategoryFollowState {
	category_id: number;
	category_name: string;
	following: boolean;
	notify: boolean;
}

/** The tags the signed-in reader follows (durable reader-level intent, DEC-195). */
export interface FollowedTagItem {
	id: number;
	name: string;
	/** Whether new-post push is enabled for this follow (TASK-215). */
	notify: boolean;
}

export interface FollowedTagListResponse {
	items: FollowedTagItem[];
	total: number;
}

export interface TagFollowState {
	tag_id: number;
	tag_name: string;
	following: boolean;
	notify: boolean;
}

/** Recent public posts from the reader's followed categories + series. */
export function useReaderFollowsFeed(limit = 12) {
	return query<PostList[]>("/api/reader/me/follows-feed", {
		query: { limit },
		headers: readerAuthHeaders(),
		server: false,
	});
}

/** Reactive list of the series the signed-in reader follows. */
export function useReaderSeriesFollows() {
	return query<FollowedSeriesListResponse>("/api/reader/me/series-follows", {
		headers: readerAuthHeaders(),
		server: false,
	});
}

/** Reactive list of the categories the signed-in reader follows. */
export function useReaderCategoryFollows() {
	return query<FollowedCategoryListResponse>("/api/reader/me/category-follows", {
		headers: readerAuthHeaders(),
		server: false,
	});
}

/** Follow a series for new-part push (idempotent). */
export function followReaderSeries(seriesId: number): Promise<SeriesFollowState> {
	return command<SeriesFollowState>(`/api/reader/me/series/${seriesId}/follow`, {
		method: "PUT",
		headers: readerAuthHeaders(),
	});
}

/** Toggle new-part push on/off for a series the reader already follows. */
export function setSeriesFollowNotify(
	seriesId: number,
	notify: boolean,
): Promise<SeriesFollowState> {
	return command<SeriesFollowState>(`/api/reader/me/series/${seriesId}/follow`, {
		method: "PATCH",
		headers: readerAuthHeaders(),
		body: { notify },
	});
}

/** Unfollow a series (idempotent 204). */
export function unfollowReaderSeries(seriesId: number): Promise<null> {
	return command<null>(`/api/reader/me/series/${seriesId}/follow`, {
		method: "DELETE",
		headers: readerAuthHeaders(),
	});
}

/** Follow a category for new-post push (idempotent). */
export function followReaderCategory(categoryId: number): Promise<CategoryFollowState> {
	return command<CategoryFollowState>(`/api/reader/me/categories/${categoryId}/follow`, {
		method: "PUT",
		headers: readerAuthHeaders(),
	});
}

/** Toggle new-post push on/off for a category the reader already follows. */
export function setCategoryFollowNotify(
	categoryId: number,
	notify: boolean,
): Promise<CategoryFollowState> {
	return command<CategoryFollowState>(`/api/reader/me/categories/${categoryId}/follow`, {
		method: "PATCH",
		headers: readerAuthHeaders(),
		body: { notify },
	});
}

/** Unfollow a category (idempotent 204). */
export function unfollowReaderCategory(categoryId: number): Promise<null> {
	return command<null>(`/api/reader/me/categories/${categoryId}/follow`, {
		method: "DELETE",
		headers: readerAuthHeaders(),
	});
}

/** Reactive list of the tags the signed-in reader follows. */
export function useReaderTagFollows() {
	return query<FollowedTagListResponse>("/api/reader/me/tag-follows", {
		headers: readerAuthHeaders(),
		server: false,
	});
}

/** Follow a tag for new-post push (idempotent). */
export function followReaderTag(tagId: number): Promise<TagFollowState> {
	return command<TagFollowState>(`/api/reader/me/tags/${tagId}/follow`, {
		method: "PUT",
		headers: readerAuthHeaders(),
	});
}

/** Toggle new-post push on/off for a tag the reader already follows. */
export function setTagFollowNotify(tagId: number, notify: boolean): Promise<TagFollowState> {
	return command<TagFollowState>(`/api/reader/me/tags/${tagId}/follow`, {
		method: "PATCH",
		headers: readerAuthHeaders(),
		body: { notify },
	});
}

/** Unfollow a tag (idempotent 204). */
export function unfollowReaderTag(tagId: number): Promise<null> {
	return command<null>(`/api/reader/me/tags/${tagId}/follow`, {
		method: "DELETE",
		headers: readerAuthHeaders(),
	});
}
