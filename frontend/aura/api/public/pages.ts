import { computed } from "vue";
import { query } from "../transport";

type Getter<T> = () => T;

/** Public page list row (footer links): identity only, no body. */
export interface PageLink {
	slug: string;
	title: string;
}

/** Public page detail: full markdown body, rendered like a post. */
export interface PagePublic extends PageLink {
	content: string;
	updated_at: string | null;
}

/** Published pages, identity only — the footer/discovery link list. */
export function usePages() {
	return query<PageLink[]>("/api/pages");
}

export function usePage(slug: string | Getter<string | null | undefined>) {
	const read = () => (typeof slug === "function" ? slug() : slug);
	// A blank slug (/pages/%20) must not become `/api/pages/`, which resolves to
	// the LIST endpoint and hands the page an array where it expects a detail.
	// Skip the request so the page renders its not-found state.
	const hasSlug = computed(() => Boolean(read()?.trim()));
	const path =
		typeof slug === "function"
			? () => `/api/pages/${encodeURIComponent(read() ?? "")}`
			: `/api/pages/${encodeURIComponent(slug)}`;
	return query<PagePublic>(path, { enabled: hasSlug });
}
