/**
 * Bridges the localStorage-only liked-post markers (useLikes, RIL ISS-038) to
 * the reader cloud-likes API (round 359, DEC-391/TASK-421).
 *
 * Like, a guest's like dedup was purely a client-side Set; a signed-in
 * reader's like now needs to survive the device and be reversible. This
 * mirrors useBookmarkSync's merge-friendly, offline-safe strategy:
 *  - While a reader is signed in, a new like ALSO posts to the cloud
 *    (likeReaderPost) and an unlike DELETEs it (decrementing the board count
 *    only on a real removal — server-enforced). Per-post writes are chained
 *    so the LAST local intent is always the LAST request to reach the server:
 *    a rapid like→unlike must end un-liked, not have the DELETE land first
 *    and leave the cloud row behind (same deep-dive finding as bookmarks).
 *  - `mergeLocalToCloud()` is the reconciliation primitive: push every local
 *    marker up (idempotent PUT-style like, no double-count), then pull the
 *    server's liked set down and merge it into the local marker set. Called
 *    on login and when the /liked page mounts while signed in, so a reader's
 *    likes made on another device appear here — the same "local wins for
 *    adds, union on re-login" trade-off bookmarks document. A like the reader
 *    UNDOES while the merge is in flight is live intent: it is skipped by the
 *    push and excluded from the pull union, so the removal is never silently
 *    resurrected by the reconciliation.
 *
 * The public like count stays a rough popularity badge (guests can still POST
 * /api/posts/{id}/like client-deduped, and a guest whose like is later
 * promoted to a reader row is a distinct actor whose count bump is separate —
 * the same heart can therefore count twice; this composable only manages the
 * reader-owned surface).
 */

import { ref } from "vue";
import { useLikes } from "./useLikes";

const READER_TOKEN_KEY = "reader_token";

function hasReaderToken(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof localStorage?.getItem === "function" &&
		!!localStorage.getItem(READER_TOKEN_KEY)
	);
}

/** True when a merge/mirror rejection means the stored session is unusable. */
function isAuthFailure(err: unknown): boolean {
	const status =
		(err as { response?: { status?: number } })?.response?.status ??
		(err as { status?: number })?.status;
	return status === 401 || status === 403;
}

/**
 * Module-scoped like the bookmark one: every useLikeSync() instance shares ONE
 * auth-warning flag so a mirror failure on the post page still lights the
 * banner on /liked. Tests reset it in beforeEach.
 */
export const likeSyncIssue = ref<"auth" | null>(null);

export function clearLikeSyncIssue(): void {
	likeSyncIssue.value = null;
}

// Per-post cloud-write serialization (same deep-dive finding as bookmarks): a
// rapid like→unlike on the SAME post issues a POST and a DELETE as independent
// in-flight requests. HTTP gives no ordering guarantee, so the DELETE can land
// before the POST — the server keeps the like row and the next /liked pull
// silently resurrects it, undoing the reader's removal with no recovery path.
// Chain per-post id so the LAST local intent is always the LAST request to
// reach the server.
const postWriteChains = new Map<number, Promise<void>>();

/** Run a cloud write for `postId` AFTER any earlier in-flight write for the
 *  same post settles, preserving add/remove intent order (see above).
 *
 *  Returns the write's own promise (a failure still flows to the caller's
 *  noteFailure/auth surface), while the stored chain tail is the caught
 *  variant — a failed write never wedges the next queued write for that
 *  post. */
function chainPostWrite(postId: number, fn: () => Promise<void>): Promise<void> {
	const prev = postWriteChains.get(postId) ?? Promise.resolve();
	const run = prev.then(fn);
	postWriteChains.set(
		postId,
		run.catch(() => {}),
	);
	return run;
}

export function useLikeSync() {
	const store = useLikes();
	const { isLiked, recordLike, undoLike, persist } = store;

	// True while a cloud reconciliation runs; the /liked page uses this to gate
	// its empty state (a fresh device's local set is empty until the cloud pull
	// lands — false "no likes yet" during that window). Starts true when a
	// token is present (same reasoning as bookmarks' syncing).
	const syncing = ref(hasReaderToken());

	function noteFailure(err: unknown): void {
		if (isAuthFailure(err)) likeSyncIssue.value = "auth";
	}

	/** Mirror a single like to the cloud (chained per post). Offline-safe:
	 *  errors swallowed; the next merge re-conciliates. */
	async function mirrorAdd(postId: number): Promise<void> {
		if (!hasReaderToken()) return;
		try {
			await chainPostWrite(postId, async () => {
				const { likeReaderPost } = await import("~~/api/reader/likes");
				await likeReaderPost(postId); // idempotent — never double-counts
				clearLikeSyncIssue();
			});
		} catch (err) {
			noteFailure(err);
		}
	}

	/** Mirror a single unlike to the cloud (chained per post). Offline-safe:
	 *  a failed mirror is NOT a hard failure (the next merge re-conciliates),
	 *  but unlike() needs to know whether the removal actually landed — the
	 *  /liked page is the SERVER's liked set, so an unpersisted removal must
	 *  not drop the card (usability deep-dive). Returns false when the mirror
	 *  failed or the reader is signed out (nothing to mirror; a guest's removal
	 *  is trivially "the cloud state").
	 *
	 *  Returns true when the cloud DELETE landed (or there is no cloud row). */
	async function mirrorRemove(postId: number): Promise<boolean> {
		if (!hasReaderToken()) return true;
		try {
			await chainPostWrite(postId, async () => {
				const { unlikeReaderPost } = await import("~~/api/reader/likes");
				await unlikeReaderPost(postId);
				clearLikeSyncIssue();
			});
			return true;
		} catch (err) {
			noteFailure(err);
			return false;
		}
	}

	/** Reconcile local + cloud: push local up, then adopt the server union. */
	async function mergeLocalToCloud(): Promise<void> {
		if (!hasReaderToken()) return;
		syncing.value = true;
		try {
			const { getReaderLikes, likeReaderPost } = await import("~~/api/reader/likes");
			// Snapshot the markers we start with: the push+walk is several
			// network round-trips, and a like the reader UNDOES meanwhile (post
			// page or this page) is live intent that the push must not re-create
			// and the pull must not resurrect.
			const startedWith = new Set(store.liked.value);
			for (const id of [...store.liked.value]) {
				// Re-check current membership per push (the iterator holds the
				// array captured when the loop STARTED): an unlike landed mid-push
				// wipes the id from the live set — pushing it again would re-create
				// the cloud row the DELETE just removed (bookmark push guard).
				if (!store.liked.value.has(id)) continue;
				await chainPostWrite(id, async () => {
					await likeReaderPost(id);
				});
			}
			// Pull the full set (bounded paging) and merge.
			let page = 1;
			let all: number[] = [];
			for (;;) {
				const res = await getReaderLikes(page, 100);
				if (!res) break;
				all = all.concat(res.items.map((p) => p.id));
				const tp = res.pagination?.total_pages ?? 1;
				if (page >= tp) break;
				page += 1;
			}
			// Reconcile the pull against live local intent from DURING the merge:
			// ids the reader unliked mid-merge MUST NOT come back (the server row
			// may not be deleted yet, so the pull snapshot can still carry them —
			// resurrecting would flip the heart back on). Whatever is still liked
			// locally (including mid-merge adds, ordered last by the chain) wins.
			const current = new Set(store.liked.value);
			const removedDuringMerge = new Set([...startedWith].filter((id) => !current.has(id)));
			const merged = new Set(current);
			for (const id of all) {
				if (!removedDuringMerge.has(id)) merged.add(id);
			}
			if (merged.size !== store.liked.value.size) {
				store.liked.value = new Set(merged);
				persist();
			}
			clearLikeSyncIssue();
		} catch (err) {
			// Cloud unreachable — keep the local markers. A dead session must
			// NOT wipe the local set; warn instead (same as bookmarks).
			noteFailure(err);
		} finally {
			syncing.value = false;
		}
	}

	/** Like locally, mirroring to the cloud when signed in. Resolves once the
	 *  mirror lands (or bails for a guest / a swallowed offline-session error),
	 *  so a caller can order its next action — e.g. a count refetch — after the
	 *  mutation instead of racing it. */
	async function like(postId: number): Promise<void> {
		recordLike(postId);
		persist();
		await mirrorAdd(postId);
	}

	/** Unlike locally, mirroring to the cloud when signed in. Resolves once the
	 *  mirror lands (or is skipped for a guest); returns whether the cloud
	 *  removal persisted. On an unpersisted mirror the local marker is rolled
	 *  back to "liked" so it stays consistent with the server truth instead of
	 *  silently diverging — the next merge re-conciliates when connectivity
	 *  returns (usability deep-dive; /liked is a server-truth page). */
	async function unlike(postId: number): Promise<boolean> {
		undoLike(postId);
		persist();
		const persisted = await mirrorRemove(postId);
		if (!persisted) {
			recordLike(postId);
			persist();
		}
		return persisted;
	}

	return {
		isLiked,
		syncing,
		likeSyncIssue,
		clearLikeSyncIssue,
		like,
		unlike,
		mergeLocalToCloud,
	};
}
