import type { PostList } from "../contracts/shared";
import { type ApiQueryPath, query } from "../transport";

type Getter<T> = () => T;

export interface SeriesPublic {
	id: number;
	title: string;
	slug: string;
	description: string | null;
	post_count: number;
}

export interface SeriesDetail extends SeriesPublic {
	posts: PostList[];
}

export function useSeries() {
	return query<SeriesPublic[]>("/api/series");
}

export function useSeriesBySlug(slug: string | Getter<string | null | undefined>) {
	const path =
		typeof slug === "function"
			? ((() => {
					const resolved = slug();
					return resolved ? `/api/series/${resolved}` : null;
				}) as ApiQueryPath)
			: `/api/series/${slug}`;
	return query<SeriesDetail>(path);
}
