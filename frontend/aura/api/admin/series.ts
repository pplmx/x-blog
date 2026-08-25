import { adminAuthHeaders } from "../auth";
import type { SeriesPublic } from "../public/series";
import { command, query } from "../transport";

export interface AdminSeries extends SeriesPublic {
	description: string | null;
	post_count: number;
}

export interface AdminSeriesInput {
	title: string;
	slug: string;
	description: string | null;
}

export interface SeriesEpisode {
	id: number;
	title: string;
	slug: string;
	series_order: number;
	published: boolean;
}

/** All series for the admin (same payload as the public list; reactive). */
export function useAdminSeries() {
	return query<AdminSeries[]>("/api/series", {
		headers: adminAuthHeaders(),
		server: false,
	});
}

/** Create a series (auth required). */
export function createAdminSeries(data: AdminSeriesInput): Promise<AdminSeries> {
	return command<AdminSeries>("/api/series", {
		method: "POST",
		headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
		body: data,
	});
}

/** Rename / re-slug a series (auth required). */
export function updateAdminSeries(
	id: number,
	data: Partial<AdminSeriesInput>,
): Promise<AdminSeries> {
	return command<AdminSeries>(`/api/series/${id}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
		body: data,
	});
}

/** Delete a series — unlinks its posts, which keep existing (auth required). */
export function deleteAdminSeries(id: number): Promise<void> {
	return command<void>(`/api/series/${id}`, {
		method: "DELETE",
		headers: adminAuthHeaders(),
	});
}

/** A series' episodes in order, including drafts (admin). */
export function getAdminSeriesEpisodes(seriesId: number): Promise<SeriesEpisode[]> {
	return command<SeriesEpisode[]>(`/api/series/${seriesId}/episodes`, {
		headers: adminAuthHeaders(),
	});
}

/** Reorder a series' episodes from an explicit post-id list (admin). */
export function reorderAdminSeriesEpisodes(
	seriesId: number,
	postIds: number[],
): Promise<SeriesEpisode[]> {
	return command<SeriesEpisode[]>(`/api/series/${seriesId}/episodes/reorder`, {
		method: "PUT",
		headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
		body: { post_ids: postIds },
	});
}
