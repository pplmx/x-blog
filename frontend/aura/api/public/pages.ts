import type { ApiQueryPath } from "../transport";
import { query } from "../transport";

type Getter<T> = () => T;

/** Public page list row (footer links): identity only, no body (round 347). */
export interface PageLink {
	slug: string;
	title: string;
}

/** Public page detail: full markdown body, rendered like a post (round 347). */
export interface PagePublic extends PageLink {
	content: string;
	updated_at: string | null;
}

/** Published pages, identity only — the footer/discovery link list. */
export function usePages() {
	return query<PageLink[]>("/api/pages");
}

export function usePage(slug: string | Getter<string | null | undefined>) {
	const path =
		typeof slug === "function"
			? ((() => {
					const resolved = slug();
					return resolved ? `/api/pages/${resolved}` : null;
				}) as ApiQueryPath)
			: `/api/pages/${slug}`;
	return query<PagePublic>(path);
}
