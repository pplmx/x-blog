import { onMounted, ref } from "vue";

/**
 * Device-local memory of the reader's last searches.
 *
 * The bare `/search` landing used to be a blank prompt: a reader who searched
 * "fastapi" yesterday had to retype it. Terms live in `localStorage` (never on
 * the server, so search history is not an account-visible record), newest
 * first, deduplicated case-insensitively and capped so the landing stays calm.
 */

export const RECENT_SEARCHES_KEY = "xblog.search.recent";
export const MAX_RECENT_SEARCHES = 5;

function storage(): Storage | null {
	if (typeof window === "undefined") return null;
	try {
		return window.localStorage;
	} catch {
		// Some privacy modes throw on access rather than on write.
		return null;
	}
}

/** Stored terms, sanitized: strings only, trimmed, newest first, capped. */
export function readRecentSearches(): string[] {
	const store = storage();
	if (!store) return [];
	try {
		const parsed: unknown = JSON.parse(store.getItem(RECENT_SEARCHES_KEY) ?? "[]");
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((term): term is string => typeof term === "string" && term.trim() !== "")
			.slice(0, MAX_RECENT_SEARCHES);
	} catch {
		// Corrupt or hand-edited storage must not break the search page.
		return [];
	}
}

/** Record a submitted term and return the new list (also what was written). */
export function rememberSearchTerm(term: string): string[] {
	const clean = term.trim();
	if (!clean) return readRecentSearches();
	const store = storage();
	const next = [
		clean,
		...readRecentSearches().filter(
			(previous) => previous.toLocaleLowerCase() !== clean.toLocaleLowerCase(),
		),
	].slice(0, MAX_RECENT_SEARCHES);
	try {
		store?.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
	} catch {
		// Quota or private mode: the chips just do not persist.
	}
	return next;
}

export function clearRecentSearches(): void {
	try {
		storage()?.removeItem(RECENT_SEARCHES_KEY);
	} catch {
		// Nothing to clear / storage inaccessible.
	}
}

export function useRecentSearches() {
	// Read on mount, not in setup: the server renders the bare landing, and
	// chips appearing during hydration would be a mismatch.
	const recentSearches = ref<string[]>([]);

	onMounted(() => {
		recentSearches.value = readRecentSearches();
	});

	function remember(term: string): void {
		recentSearches.value = rememberSearchTerm(term);
	}

	function clear(): void {
		clearRecentSearches();
		recentSearches.value = [];
	}

	return { recentSearches, remember, clear };
}
