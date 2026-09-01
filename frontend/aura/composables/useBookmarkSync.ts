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

/**
 * The kinds of cloud-sync problems we surface to the reader. Currently only
 * "auth": the stored token is present but no longer accepted (expired/revoked
 * — the backend answers 401; a wrong-audience token answers 403). hasReaderToken
 * checks *presence* only, so without this a dead session would keep presenting
 * "saved to cloud" while the server silently rejects every mirror — and a later
 * merge would pull the never-saved bookmark away (ISS-222). Transient failures
 * (offline, 5xx) deliberately stay silent: the next merge re-conciliates.
 */
type SyncIssue = "auth" | null;

/** True when a mirror/merge rejection means the stored session is unusable. */
function isAuthFailure(err: unknown): boolean {
	const status =
		(err as { response?: { status?: number } })?.response?.status ??
		(err as { status?: number })?.status;
	return status === 401 || status === 403;
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
	const { bookmarks, addBookmark, removeBookmark, replaceBookmarks, clearBookmarks } = store;

	// True while a cloud reconciliation (mergeLocalToCloud) is running. The
	// bookmarks page uses this to gate its empty state: on a fresh device the
	// local list is empty until the cloud pull lands, and showing "you have no
	// bookmarks yet" during that window is a false negative (deep-dive finding).
	const syncing = ref(false);

	// Non-null when the last sync attempt proved the stored session is dead
	// (ISS-222). The bookmarks page renders a dismissible warning off this; the
	// toggle itself keeps working locally.
	const syncIssue = ref<SyncIssue>(null);

	const clearSyncIssue = (): void => {
		syncIssue.value = null;
	};

	/** Interpret a mirror/merge rejection: auth failures are surfaced, the rest
	 *  (offline/5xx) keep their offline-safe silence. */
	function noteFailure(err: unknown): void {
		if (isAuthFailure(err)) {
			syncIssue.value = "auth";
		}
	}

	/** Mirror a single add to the cloud. Offline-safe: errors are swallowed. */
	async function mirrorAdd(postId: number): Promise<void> {
		if (!hasReaderToken()) return;
		try {
			const { addReaderBookmark } = await import("~~/api/reader/bookmarks");
			await addReaderBookmark(postId);
			clearSyncIssue(); // the session works again — drop any stale warning
		} catch (err) {
			// offline — local list is authoritative until next merge; a dead
			// session is the one case the reader must not be left in the dark.
			noteFailure(err);
		}
	}

	/** Mirror a single remove to the cloud. Offline-safe: errors are swallowed. */
	async function mirrorRemove(postId: number): Promise<void> {
		if (!hasReaderToken()) return;
		try {
			const { removeReaderBookmark } = await import("~~/api/reader/bookmarks");
			await removeReaderBookmark(postId);
			clearSyncIssue();
		} catch (err) {
			// offline — next merge re-conciliates
			noteFailure(err);
		}
	}

	/** Reconcile local + cloud: push local up, adopt the server union down. */
	async function mergeLocalToCloud(): Promise<void> {
		if (!hasReaderToken()) return;
		syncing.value = true;
		try {
			const { addReaderBookmark, getReaderBookmarks } = await import("~~/api/reader/bookmarks");
			// Push local bookmarks up (idempotent PUT; a full Bookmark carries the
			// post id we PUT with).
			for (const b of bookmarks.value) {
				await addReaderBookmark(b.id);
			}
			// Pull the whole merged server list and make it the local truth.
			// The endpoint is bounded per page (ISS-142), so walk total_pages
			// instead of relying on one response to contain everything.
			let all: ReaderBookmarkItem[] = [];
			let page = 1;
			for (;;) {
				const res = await getReaderBookmarks(undefined, page);
				if (!res) break;
				all = all.concat(res.items);
				if (page >= (res.total_pages ?? 1)) break;
				page += 1;
			}
			replaceBookmarks(all.map(toLocalBookmark));
			clearSyncIssue();
		} catch (err) {
			// Cloud unreachable — keep the local list untouched. A dead session
			// must NOT replace the local list with the unreachable server truth
			// (silent deletion of local-only bookmarks), so warn instead (ISS-222).
			noteFailure(err);
		} finally {
			syncing.value = false;
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

	/**
	 * Clear every bookmark — local AND cloud when signed in (TASK-233).
	 *
	 * The previous ``clearBookmarks()`` wiped only localStorage, so a signed-in
	 * reader's "Clear all" silently resurrected on the next mount when
	 * mergeLocalToCloud pulled the server list back down. Offline-safe: if the
	 * cloud clear fails we keep the local wipe (the cloud has nothing new) and
	 * the next merge re-reconciles; a signed-out reader just clears locally.
	 */
	async function clearAll(): Promise<void> {
		clearBookmarks();
		if (!hasReaderToken()) return;
		try {
			const { clearReaderBookmarks } = await import("~~/api/reader/bookmarks");
			await clearReaderBookmarks();
			clearSyncIssue();
		} catch (err) {
			// offline — local cleared; server rows clear on the next clear/merge
			noteFailure(err);
		}
	}

	return {
		...store,
		isSignedIn: hasReaderToken,
		syncing,
		syncIssue,
		clearSyncIssue,
		add,
		remove,
		clearAll,
		mergeLocalToCloud,
	};
}
