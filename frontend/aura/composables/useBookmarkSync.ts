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
export type SyncIssue = "auth" | null;

/**
 * Module-scoped so every useBookmarkSync() instance shares ONE auth-warning
 * flag: a mirror failure on a post-page BookmarkButton (its own instance) still
 * lights the banner on /bookmarks (a different instance). Same singleton
 * rationale as useBookmarks()/useReaderAuth(). Tests reset it in beforeEach.
 */
export const syncIssue = ref<SyncIssue>(null);

/** Non-null when the last sync attempt proved the stored session is dead
 *  (ISS-222). The bookmarks page renders a dismissible warning off this; the
 *  toggle itself keeps working locally. */
export function clearSyncIssue(): void {
	syncIssue.value = null;
}

/**
 * Bumped by every Clear-all so an in-flight merge can tell that the local list
 * was intentionally wiped while it was pushing/pulling (deep-dive finding, cf.
 * TASK-233). A merge that started before the clear MUST NOT replace the local
 * list with its (now stale) pull snapshot — that would resurrect cleared
 * bookmarks in the UI until the next clear/merge, silently undoing Clear-all.
 */
let clearEpoch = 0;

// Cloud-write serialization for Clear-all (TASK-233 hardening). A PUT that is
// already in flight when Clear-all fires can reach the server AFTER the clear's
// DELETE and re-create the id cloud-side — the per-PUT membership check only
// stops FUTURE PUTs, and the epoch gate only keeps the local list clean, so the
// next merge would pull the resurrected row straight back down. To close it,
// Clear-all waits for every in-flight cloud write to land BEFORE issuing the
// DELETE, so the DELETE is always the last write it knows about.
let pendingWrites = 0;
let settleWrites: (() => void) | null = null;

/** Run a cloud write, tracking it so Clear-all can await it before wiping. */
function withPendingWrite<T>(fn: () => T | Promise<T>): Promise<T> {
	pendingWrites += 1;
	// Defer fn into the promise chain (rather than calling it first) so a mock
	// that returns undefined or a synchronous throw can never leak the increment:
	// the finally always runs and decrements.
	return Promise.resolve()
		.then(fn)
		.finally(() => {
			pendingWrites -= 1;
			if (pendingWrites === 0 && settleWrites) {
				const resolve = settleWrites;
				settleWrites = null;
				resolve();
			}
		});
}

/** Resolves once every tracked in-flight cloud write has settled. */
function waitForWritesIdle(): Promise<void> {
	if (pendingWrites === 0) return Promise.resolve();
	return new Promise<void>((resolve) => {
		settleWrites = resolve;
	});
}

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
	// Starts TRUE when a reader token is present so the very first client paint
	// of /bookmarks (before mount's merge even sets syncing) already shows the
	// in-flight hint instead of flashing the false empty state; guests (no
	// token) start false and see the real empty state immediately.
	const syncing = ref(hasReaderToken());

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
			await withPendingWrite(async () => {
				const { addReaderBookmark } = await import("~~/api/reader/bookmarks");
				await addReaderBookmark(postId);
				clearSyncIssue(); // the session works again — drop any stale warning
			});
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
			await withPendingWrite(async () => {
				const { removeReaderBookmark } = await import("~~/api/reader/bookmarks");
				await removeReaderBookmark(postId);
				clearSyncIssue();
			});
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
			// Snapshot the ids we start with: the push+walk is several network
			// round-trips, and a bookmark the reader ADDS meanwhile (post page or
			// this page) is live intent that the pull must not wipe from the UI —
			// even if its mirrorAdd hasn't landed yet, the next merge reconciles.
			const startedWith = new Set(bookmarks.value.map((b) => b.id));
			const epoch = clearEpoch;
			// Push local bookmarks up (idempotent PUT; a full Bookmark carries the
			// post id we PUT with). Re-check membership per PUT: the iterator holds
			// the array captured when the loop STARTED, and a "Clear all" clicked
			// mid-push wipes that array — without the check the merge would keep
			// PUT-ing the just-cleared ids, some landing after the cloud DELETE
			// and resurrecting them on the server for the next merge (deep-dive
			// finding — undermines TASK-233's "clear sticks to the cloud").
			for (const b of bookmarks.value) {
				if (!bookmarks.value.some((x) => x.id === b.id)) continue;
				// Track the PUT as a cloud write so a Clear-all fired mid-push
				// waits for THIS one to land before DELETing the cloud list —
				// otherwise it can arrive after the DELETE and resurrect the id.
				await withPendingWrite(() => addReaderBookmark(b.id));
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
			// Reconcile the server snapshot against live local intent from DURING
			// the merge (each several round-trips):
			//  - adds: re-adopt bookmarks created mid-merge (their mirrorAdd may
			//    not have landed yet), so a fresh tap survives the replace;
			//  - removes: drop ids the reader removed mid-merge whose DELETE has
			//    not hit the server yet — the stale pull snapshot would otherwise
			//    resurrect them in the UI until the next merge.
			// Id-deduped at the end; the next merge reconciles the server rows.
			const pulled = all.map(toLocalBookmark);
			const currentIds = new Set(bookmarks.value.map((b) => b.id));
			const removedDuringMerge = new Set([...startedWith].filter((id) => !currentIds.has(id)));
			const midMergeAdds = bookmarks.value.filter((b) => !startedWith.has(b.id));
			const merged = pulled.filter((b) => !removedDuringMerge.has(b.id)).concat(midMergeAdds);
			// A Clear-all that landed while the merge was in flight wins over the
			// merge's stale snapshot: the reader wiped the list (and the cloud) on
			// purpose, so restore nothing.
			if (epoch === clearEpoch) {
				replaceBookmarks(merged.filter((b, i) => merged.findIndex((x) => x.id === b.id) === i));
			}
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
		clearEpoch += 1; // any in-flight merge must not restore what we're wiping
		clearBookmarks();
		if (!hasReaderToken()) return;
		try {
			// Let every in-flight cloud write (mirror PUTs/DELETEs and the merge's
			// push) land BEFORE the clear's DELETE, so none can arrive after it and
			// resurrect an id server-side. The local wipe already happened, so this
			// is pure ordering insurance for the cloud (TASK-233 hardening).
			await waitForWritesIdle();
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
