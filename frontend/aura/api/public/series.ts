import { computed } from "vue";
import type { PostList } from "../contracts/shared";
import { query } from "../transport";

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
	const read = () => (typeof slug === "function" ? slug() : slug);
	// A blank slug (/series/%20) must not become `/api/series/`, which resolves
	// to the LIST endpoint and hands the page a series row where it expects a
	// detail. Skip the request so the page renders its not-found state.
	const hasSlug = computed(() => Boolean(read()?.trim()));
	const path =
		typeof slug === "function"
			? () => `/api/series/${encodeURIComponent(read() ?? "")}`
			: `/api/series/${encodeURIComponent(slug)}`;
	return query<SeriesDetail>(path, { enabled: hasSlug });
}
