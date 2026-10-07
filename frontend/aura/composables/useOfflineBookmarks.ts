/**
 * Bridges the /bookmarks page to the service worker's bookmarked-post offline
 * cache (PWA offline slice). Two jobs:
 *
 *  1. Precache / prune: for a signed-in reader, tell the SW (via postMessage)
 *     to proactively fetch-and-cache their saved posts into the dedicated
 *     `xblog-bookmarks-v1` cache (so a bookmarked post reads offline even if it
 *     was never visited) and to drop a post's cache entry when it is unsaved.
 *  2. Offline indicator: expose which saved posts are currently available
 *     offline by inspecting that same cache, so the /bookmarks rows can render
 *     an "available offline" badge that reflects real cache state.
 *
 * The cache name lives here AND in public/sw.js — keep the two in sync.
 * The cache is origin-scoped, so this page JS can open it and match entries
 * exactly as the SW writes them.
 */
import { ref } from "vue";
import { useBookmarks } from "./useBookmarks";

/** Must match BOOKMARKS_CACHE_NAME in public/sw.js. */
export const OFFLINE_BOOKMARKS_CACHE = "xblog-bookmarks-v1";

// Module-scoped so every useOfflineBookmarks() instance shares ONE reactive
// availability set (same singleton rationale as useBookmarks/useReaderAuth).
const offlineSlugs = ref(new Set<string>());

function isClient(): boolean {
	return typeof window !== "undefined" && "caches" in window;
}

/** Resolve a service worker client to message — the controller if this page is
 *  under its control, else the active worker of the registration (works even on
 *  the very first visit before the SW takes control). Fire-and-forget: if no
 *  worker is reachable (no SW support, or not yet installed) we quietly skip. */
async function getSwClient(): Promise<ServiceWorker | null> {
	if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
	if (navigator.serviceWorker.controller) return navigator.serviceWorker.controller;
	try {
		const reg = await navigator.serviceWorker.ready;
		return reg.active;
	} catch {
		return null;
	}
}

export function useOfflineBookmarks() {
	const { bookmarks } = useBookmarks();

	/** Recompute the set of saved-post slugs currently present in the bookmarks
	 *  offline cache. Call after mounting the page and after a precache settles. */
	async function refreshOfflineStatus(): Promise<void> {
		if (!isClient()) {
			offlineSlugs.value = new Set();
			return;
		}
		const available = new Set<string>();
		try {
			const cache = await window.caches.open(OFFLINE_BOOKMARKS_CACHE);
			for (const b of bookmarks.value) {
				if (await cache.match(new URL(`/posts/${b.slug}`, window.location.origin).href)) {
					available.add(b.slug);
				}
			}
		} catch {
			// CacheStorage unavailable/blocked — treat as nothing offline.
		}
		offlineSlugs.value = available;
	}

	/** Ask the SW to fetch-and-cache each saved post path, then re-read the cache
	 *  shortly after so the indicator reflects the new availability. */
	async function precache(paths: string[]): Promise<void> {
		if (paths.length === 0) return;
		const sw = await getSwClient();
		if (sw) sw.postMessage({ type: "offline-precache", posts: paths });
		// The SW write is fire-and-forget; re-query a couple of beats later so
		// the offline indicator tracks the finished fetch pass.
		setTimeout(() => void refreshOfflineStatus(), 1500);
		setTimeout(() => void refreshOfflineStatus(), 4000);
	}

	/** Ask the SW to drop the unsaved post paths, then reflect the change in the
	 *  indicator immediately (the cache delete is fast). */
	async function prune(paths: string[]): Promise<void> {
		if (paths.length === 0) return;
		const sw = await getSwClient();
		if (sw) sw.postMessage({ type: "offline-unbookmark", posts: paths });
		await refreshOfflineStatus();
	}

	function isAvailable(slug: string): boolean {
		return offlineSlugs.value.has(slug);
	}

	return { offlineSlugs, refreshOfflineStatus, precache, prune, isAvailable };
}
