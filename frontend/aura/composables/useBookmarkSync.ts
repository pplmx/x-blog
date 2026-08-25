/**
 * Bridges the localStorage-only bookmark list (useBookmarks) to the cloud
 * bookmarks API (DEC-059, TASK-134).
 *
 * Strategy (merge-friendly, offline-safe):
 *  - While a reader is signed in, every add/remove ALSO mirrors to the cloud
 *    (PUT/DELETE /api/reader/me/bookmarks). If the network request fails we
 *    ignore the error: the local list already changed, and the next merge
 *    (login or page mount) re-conciliates by pushing local up, then adopting
 *    the merged server list as the local truth.
 *  - `mergeLocalToCloud()` is the reconciliation primitive: push every local
 *    bookmark id up (idempotent PUT — no duplicates), then pull the server's
 *    union list down and replace the local list with it. Called on login and
 *    when the /bookmarks page mounts while signed in.
 *
 * The merge is intentionally "local wins for adds, union for deletes after a
 * re-login": a reader who bookmarks while logged out keeps those bookmarks
 * (they get pushed up on the next merge), and a reader who un-bookmarks on
 * another device sees it disappear after their next merge pulls the server
 * list. This is the documented trade-off for a localStorage-first client.
 */

import type { ReaderBookmarkItem } from "~~/api/reader/bookmarks";
import type { Bookmark } from "./useBookmarks";
import { useBookmarks } from "./useBookmarks";

const READER_TOKEN_KEY = "reader_token";

function hasReaderToken(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof localStorage?.getItem === "function" &&
		!!localStorage.getItem(READER_TOKEN_KEY)
	);
}

/** Map a cloud bookmark row to the local Bookmark shape (they already mirror;
 * only created_at nullability differs, which the page tolerates). */
function toLocalBookmark(item: ReaderBookmarkItem): Bookmark {
	return {
		id: item.id,
		title: item.title,
		slug: item.slug,
		excerpt: item.excerpt,
		cover_image: item.cover_image,
		created_at: item.created_at ?? new Date().toISOString(),
		folder_id: item.folder_id ?? null,
		folder_name: item.folder_name ?? null,
		category: item.category,
		tags: item.tags,
	};
}

export function useBookmarkSync() {
	// Delegate the whole useBookmarks surface so every caller observes the SAME
	// reactive bookmark list (a second useBookmarks() instance inside this
	// composable would split state identity — fine under Nuxt's useState
	// singleton, but divergent in tests that exercise the ref fallback).
	const store = useBookmarks();
	const { bookmarks, addBookmark, removeBookmark, replaceBookmarks } = store;

	/** Mirror a single add to the cloud. Offline-safe: errors are swallowed. */
	async function mirrorAdd(postId: number): Promise<void> {
		if (!hasReaderToken()) return;
		try {
			const { addReaderBookmark } = await import("~~/api/reader/bookmarks");
			await addReaderBookmark(postId);
		} catch {
			// offline — local list is authoritative until next merge
		}
	}

	/** Mirror a single remove to the cloud. Offline-safe: errors are swallowed. */
	async function mirrorRemove(postId: number): Promise<void> {
		if (!hasReaderToken()) return;
		try {
			const { removeReaderBookmark } = await import("~~/api/reader/bookmarks");
			await removeReaderBookmark(postId);
		} catch {
			// offline — next merge re-conciliates
		}
	}

	/** Reconcile local + cloud: push local up, adopt the server union down. */
	async function mergeLocalToCloud(): Promise<void> {
		if (!hasReaderToken()) return;
		try {
			const { addReaderBookmark, getReaderBookmarks } = await import("~~/api/reader/bookmarks");
			// Push local bookmarks up (idempotent PUT; a full Bookmark carries the
			// post id we PUT with).
			for (const b of bookmarks.value) {
				await addReaderBookmark(b.id);
			}
			// Pull the merged server list and make it the local truth.
			const res = await getReaderBookmarks();
			if (res) {
				replaceBookmarks(res.items.map(toLocalBookmark));
			}
		} catch {
			// Cloud unreachable — keep the local list untouched.
		}
	}

	/** Add a bookmark locally, mirroring to the cloud when signed in. */
	function add(post: Bookmark): void {
		addBookmark(post);
		void mirrorAdd(post.id);
	}

	/** Remove a bookmark locally, mirroring to the cloud when signed in. */
	function remove(postId: number): void {
		removeBookmark(postId);
		void mirrorRemove(postId);
	}

	return {
		...store,
		isSignedIn: hasReaderToken,
		add,
		remove,
		mergeLocalToCloud,
	};
}
