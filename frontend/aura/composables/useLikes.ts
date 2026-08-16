import { ref } from "vue";

// Per-user "liked this post" markers, persisted client-side so a visitor can
// like a post at most once (RIL ISS-038). Without this, POST /like incremented
// unconditionally and the count could be inflated unboundedly.
const STORAGE_KEY = "x_blog_liked_posts";

function isClient(): boolean {
	return typeof window !== "undefined";
}

function canUseNuxt(): boolean {
	return typeof useState === "function";
}

function loadFromStorage(): Set<number> {
	if (!isClient()) return new Set();
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		const arr: unknown = raw ? JSON.parse(raw) : [];
		return new Set(Array.isArray(arr) ? (arr as number[]) : []);
	} catch {
		return new Set();
	}
}

function saveToStorage(markers: Set<number>): void {
	if (!isClient()) return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify([...markers]));
	} catch {
		// Storage full or unavailable — silently ignore
	}
}

/**
 * Tracks which posts the current visitor has liked, shared across components
 * via a Nuxt `useState` singleton (module-scoped ref fallback in vitest).
 */
export function useLikes() {
	const liked = canUseNuxt()
		? useState<Set<number>>("x_blog_liked_set", () => loadFromStorage())
		: ref<Set<number>>(loadFromStorage());

	// Re-read storage client-side on a full page load (SSR initializes empty).
	if (canUseNuxt() && isClient() && liked.value.size === 0) {
		liked.value = loadFromStorage();
	}

	function isLiked(postId: number): boolean {
		return liked.value.has(postId);
	}

	function recordLike(postId: number): void {
		if (!isClient()) return;
		liked.value = new Set(liked.value).add(postId);
	}
	function undoLike(postId: number): void {
		if (!isClient()) return;
		const next = new Set(liked.value);
		next.delete(postId);
		liked.value = next;
	}

	// Persist whenever the marker set changes.
	function persist(): void {
		saveToStorage(liked.value);
	}

	return { liked, isLiked, recordLike, undoLike, persist };
}
