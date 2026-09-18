import { ref } from "vue";

import { getBlockedReaders } from "~~/api/reader/blocks";
import { useReaderAuth } from "~~/composables/useReaderAuth";

/**
 * The reader ids this signed-in viewer has blocked (round 386, DEC-437).
 *
 * Round 379 shipped reader-as-receiver blocking (DEC-425): it suppresses the
 * notification fan-outs, but a blocked reader's comments still rendered in the
 * thread, the discussion feed and comment search — the DEC-425 rationale even
 * promises "a blocked commenter is invisible to them even mid-thread", which
 * was only true of the notification path. Blocking is a RECEIVER-side opt-out,
 * so the suppression belongs on this viewer's client: surfaces that render
 * other readers' comments (CommentList, the discussion feed, comment search)
 * drop rows whose author is in this set.
 *
 * The block list is fetched once per consumer when the viewer is signed in
 * (the /me/blocks endpoint is auth-gated); an empty set for guests keeps the
 * anonymous fast path byte-identical. Best effort: a failed fetch yields the
 * empty set (an empty block list hides nothing) and must never break a public
 * comment surface. The important subtlety that keeps this client-side: the
 * reader token lives in localStorage only (no cookie), so SSR cannot know who
 * is viewing — filtering on the server would be invisible on first paint.
 */
export function useBlockedReaderIds() {
	const { isAuthenticated } = useReaderAuth();
	const blockedReaderIds = ref<ReadonlySet<number>>(new Set());
	// Once-per-consumer guard: an empty block list is still a valid result and
	// must not re-arm the fetch (a reader who has blocked nobody is the
	// common case, so the set being empty says nothing about whether we loaded).
	let loaded = false;

	async function loadBlockedReaderIds(): Promise<void> {
		if (!isAuthenticated.value || loaded) return;
		loaded = true;
		try {
			const response = await getBlockedReaders();
			blockedReaderIds.value = new Set(response.items.map((item) => item.reader_id));
		} catch {
			// Best effort: a failed block-list fetch must not break the page.
			// This instance never retries; navigating to a new page creates a
			// fresh consumer (and therefore a fresh load).
		}
	}

	return { blockedReaderIds, loadBlockedReaderIds };
}
