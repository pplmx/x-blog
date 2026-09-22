/**
 * Per-post resume reading (DEC-167, TASK-200).
 *
 * A signed-in reader's last scroll offset inside a post is saved server-side
 * (ReadingHistory.scroll_position) so returning to the post drops them back
 * where they left off. This composable owns the client side:
 *
 *  - `restore()` fetches the saved offset and scrolls to it once the content
 *    has settled. Images/embeds shift layout while they load, so the scroll is
 *    re-applied on `window.load` and a short settle window — but any pending
 *    re-apply is cancelled the moment the reader scrolls themselves, so we
 *    never fight the user.
 *  - `save()` records the current offset with a trailing debounce (throttling
 *    network writes) and `flush()` pushes the pending offset on unmount or
 *    pagehide. Saves only start after a small threshold so a bounce (open the
 *    post, read nothing, leave) does not wipe the saved place for next time.
 *
 * All writes go through `recordReaderHistory` → `$fetch`, matching the
 * ISS-111/DEC-165 rule: `useFetch` silently no-ops outside a setup/suspense
 * context, so fire-and-forget client calls from lifecycle/handler code must
 * use `$fetch`. Guests opt out entirely — the server trail is reader-only.
 */

import { onUnmounted, ref } from "vue";
import { getReaderReadingPosition, recordReaderHistory } from "~~/api/reader/history";
import { useReaderAuth } from "./useReaderAuth";

/** Ignore offsets below this many px: too small to be worth restoring, and
 * small scrolls are indistinguishable from "just opened the top". */
const MIN_SAVE_PX = 96;
/** Re-apply the restored scroll this often (ms) as images/embeds settle. */
const SETTLE_TIMEOUTS_MS = [350, 900, 1800];
/** Trailing debounce between consecutive scroll saves. */
const SAVE_DEBOUNCE_MS = 2500;

export interface ResumeReadingApi {
	/** Last restored offset in px, or null when there was nothing to restore. */
	restoredPosition: ReturnType<typeof ref<number | null>>;
	/** True while fetching the saved position. */
	restoring: ReturnType<typeof ref<boolean>>;
	/** Fetch the saved offset and scroll to it (client + signed-in only). */
	restore: () => Promise<number | null>;
	/** Record the current scroll offset (debounced, thresholded). */
	save: (position: number) => void;
	/** Push any pending offset immediately (unmount / pagehide). */
	flush: () => void;
	/** Scroll back to the top, clear the restored marker, and wipe the saved
	 * server position so the next visit starts at the top (not a stale chip
	 * a few pixels down). */
	jumpToTop: () => void;
	/** Cancel pending restore re-applies (e.g. the reader scrolled manually). */
	cancelRestore: () => void;
	/** Clear the restored marker and drop any pending save for an SPA post
	 * switch, so one post's resume state never bleeds into the next. */
	reset: () => void;
}

export function useResumeReading(postId: () => number | undefined): ResumeReadingApi {
	const { isAuthenticated } = useReaderAuth();
	const restoredPosition = ref<number | null>(null);
	const restoring = ref(false);

	let lastSaved = -1;
	let pendingPos: number | null = null;
	// Cross-viewport resume fraction pending alongside the pixel (DEC-346/
	// TASK-399): captured at save time from the current document height so a
	// continuation on a differently-sized viewport restores at the same place.
	// Null when the save had no measurable scroll range.
	let pendingFraction: number | null = null;
	// The post a pending save belongs to. Kept alongside the offset so a later
	// `flush()`/`reset()` still writes to the post the reader was actually on —
	// recomputing the id via the `activePostId()` getter after an SPA post
	// switch would tag the old post's offset onto the NEW post's history row.
	let pendingId: number | null = null;
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let cancelRestores: (() => void) | null = null;
	// While non-zero, scroll events are ignored (used briefly after the
	// back-to-top wipe so the smooth animation's intermediate offsets cannot
	// write a stale position back over the explicit 0).
	let suppressSavesUntil = 0;
	// Monotonic generation for restore() (round-422 audit, HIGH): the post
	// page's postId watcher calls reset() the moment an SPA post switch happens,
	// but an in-flight restore() that has not resolved yet sees nothing to
	// cancel (its applyScroll hasn't begun). Without a generation an old post's
	// saved offset could land after the switch and scroll the NEW post to a
	// wrong position. Every restore() takes a fresh generation and reset() (this
	// generation's "context changed" signal) advances it, so a resolve whose
	// generation is stale is discarded — the same monotonic pattern as
	// loadSeq/refreshEpoch elsewhere.
	let restoreGeneration = 0;

	/** True in any DOM environment (real browser or the happy-dom test env);
	 * on the SSR render there is no window and the whole composable is inert.
	 * (Uses `typeof window` rather than Nuxt's `import.meta.client` — Vitest
	 * does not statically replace that flag, so it stays `undefined` there and
	 * would lock the logic out of the unit tests.) */
	function isClient(): boolean {
		return typeof window !== "undefined";
	}

	/** The post id this composable should act on, or undefined when the reader
	 * is a guest or the post has not loaded yet. */
	function activePostId(): number | undefined {
		if (!isClient() || !isAuthenticated.value) return undefined;
		return postId();
	}

	/** Current vertical scroll range in px (0 when there is no scrolling room). */
	function scrollRange(): number {
		if (typeof document === "undefined" || typeof window === "undefined") return 0;
		return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
	}

	/** Clamp into [0, 1]; undefined when the document has no scrollable range. */
	function pixelToFraction(px: number): number | undefined {
		const range = scrollRange();
		return range > 0 ? Math.min(1, Math.max(0, px / range)) : undefined;
	}

	/** Convert a saved fraction into pixels for the CURRENT viewport. */
	function fractionToPixel(fraction: number): number {
		return Math.max(0, Math.round(fraction * scrollRange()));
	}

	async function restore(): Promise<number | null> {
		const id = activePostId();
		if (!id) return null;
		const generation = ++restoreGeneration;
		restoring.value = true;
		try {
			const data = await getReaderReadingPosition(id);
			// A stale resolve (post switched mid-fetch, reset() advanced the
			// generation, or a newer restore() superseded it) must not scroll or
			// mark a position for the WRONG article. fractionToPixel/applyScroll
			// below read the CURRENT document, so even the math would be against
			// the new post — drop the whole result (round-422 audit).
			if (generation !== restoreGeneration) return null;
			// Prefer the cross-viewport fraction (DEC-346/TASK-399): it restores
			// at the same place on any viewport. Fall back to the pixel for
			// pre-feature rows (null fraction) — today's exact behavior.
			let pos: number | null = null;
			if (data?.scroll_fraction != null && data.scroll_fraction > 0) {
				pos = fractionToPixel(data.scroll_fraction);
			}
			if (pos == null) pos = data?.scroll_position ?? null;
			if (pos != null && pos >= MIN_SAVE_PX) {
				applyScroll(id, pos);
				restoredPosition.value = pos;
				return pos;
			}
			return null;
		} catch {
			// Best-effort resume — a failed fetch must not break the post page.
			return null;
		} finally {
			// Only the newest generation clears the spinner — a stale restore
			// resolving after a newer one is in flight must not flip it off early.
			if (generation === restoreGeneration) restoring.value = false;
		}
	}

	/** Scroll to ``pos`` and re-apply a few times as layout settles, unless the
	 * reader starts scrolling themselves.
	 *
	 * A programmatic ``window.scrollTo`` also fires a scroll event, so user
	 * scrolls are detected via a timestamp guard rather than any scroll event —
	 * otherwise the first re-apply would be mistaken for a manual scroll and
	 * the settle re-applies (which exist because images shift layout) would be
	 * cancelled immediately. */
	function applyScroll(_postId: number, pos: number): void {
		let lastAutoScroll = 0;
		const scrollTo = () => {
			lastAutoScroll = Date.now();
			window.scrollTo({ top: pos, behavior: "auto" });
		};
		const isUserScroll = () => Date.now() - lastAutoScroll > 200;
		scrollTo();

		let timers: ReturnType<typeof setTimeout>[] = [];
		let settled = false;
		let manualScroll = false;

		const cancel = () => {
			settled = true;
			window.removeEventListener("scroll", onManualScroll, { capture: true });
			window.removeEventListener("load", onLoad);
			timers.forEach(clearTimeout);
			timers = [];
		};
		// function declarations hoist, so these are safe to reference in cancel()
		function onManualScroll(): void {
			if (isUserScroll()) {
				manualScroll = true;
				cancel();
			}
		}
		function onLoad(): void {
			if (!settled && !manualScroll) scrollTo();
		}

		window.addEventListener("scroll", onManualScroll, { capture: true, passive: true });
		window.addEventListener("load", onLoad);
		timers = SETTLE_TIMEOUTS_MS.map((ms) =>
			setTimeout(() => {
				if (!settled && !manualScroll) scrollTo();
			}, ms),
		);
		// Stop re-applying shortly after the last settle window.
		const lastSettle = SETTLE_TIMEOUTS_MS[SETTLE_TIMEOUTS_MS.length - 1] ?? 1800;
		timers.push(
			setTimeout(() => {
				cancel();
			}, lastSettle + 800),
		);
		cancelRestores = cancel;
	}

	function save(position: number): void {
		const id = activePostId();
		if (!id) return;
		if (Date.now() < suppressSavesUntil) return;
		const pos = Math.max(0, Math.floor(position));
		if (pos < MIN_SAVE_PX || pos === lastSaved) return;
		pendingPos = pos;
		// Fraction computed NOW (the document layout the reader is positioned
		// against) so a different-device continuation restores proportionally.
		pendingFraction = pixelToFraction(pos) ?? null;
		pendingId = id;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			saveTimer = null;
			if (pendingPos == null || pendingPos === lastSaved) return;
			lastSaved = pendingPos;
			recordReaderHistory(pendingId ?? id, pendingPos, pendingFraction ?? undefined).catch(
				() => {},
			);
			pendingPos = null;
			pendingFraction = null;
			pendingId = null;
		}, SAVE_DEBOUNCE_MS);
	}

	function flush(): void {
		// The id comes from what the pending save was recorded AGAINST, never
		// recomputed live: on an SPA post switch the getter already points at
		// the next post, and writing the old post's offset under the new post's
		// id would corrupt the resume trail.
		const id = pendingId ?? activePostId();
		const pos = pendingPos;
		const frac = pendingFraction;
		pendingPos = null;
		pendingFraction = null;
		pendingId = null;
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
		if (!id || pos == null || pos < MIN_SAVE_PX || pos === lastSaved) return;
		lastSaved = pos;
		recordReaderHistory(id, pos, frac ?? undefined).catch(() => {});
	}

	function jumpToTop(): void {
		// The reader explicitly chose the top — a restore still in flight must
		// not resolve after this and yank them back down. Same generation
		// invalidation as reset() (round-422 audit).
		restoreGeneration += 1;
		cancelRestores?.();
		window.scrollTo({ top: 0, behavior: "smooth" });
		restoredPosition.value = null;
		clearPendingSave();
		const id = activePostId();
		if (id) {
			// Explicitly wipe the server-side position: the smooth scroll's
			// intermediate events max out just below MIN_SAVE_PX and its final
			// `0` is below the save threshold, so without this the next visit
			// would restore to a stale ~100px (and show a bogus chip) instead
			// of the top. `0` is the documented "clear" value (DEC-167).
			lastSaved = 0;
			// The fraction must be cleared too or a later cross-device restore
			// would prefer the stale nonzero fraction over the cleared pixel
			// (DEC-346/TASK-399).
			recordReaderHistory(id, 0, 0).catch(() => {});
			// The smooth scroll still fires scroll events for ~a second; ignore
			// them so an intermediate offset cannot write over the clear.
			suppressSavesUntil = Date.now() + 1500;
		}
	}

	/** Drop any scheduled/tracked save without writing it (used when jumping
	 * back to the top, where the residual offset is intentionally stale). */
	function clearPendingSave(): void {
		pendingPos = null;
		pendingFraction = null;
		pendingId = null;
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
	}

	function cancelRestore(): void {
		cancelRestores?.();
	}

	function reset(): void {
		// Invalidate any in-flight restore() for the OLD post before flushing:
		// the pending fetch must not resolve after the switch and scroll the new
		// article (round-422 audit). cancelRestores() below only cancels an
		// already-started applyScroll — the generation covers the fetch window.
		restoreGeneration += 1;
		cancelRestores?.();
		suppressSavesUntil = 0;
		// Flush before discarding: on an SPA post switch the previous post's
		// trailing-debounced offset may still be pending (up to SAVE_DEBOUNCE_MS
		// of reading) — dropping it would lose the reader's end-of-article
		// restore point for that post. flush() writes to the recorded pendingId,
		// so it lands on the RIGHT post even though the getter now returns the
		// next one.
		flush();
		// Fresh dedup register for the incoming post: lastSaved now holds the
		// PREVIOUS post's flushed pixel, and without resetting it the next post
		// would silently skip saving an offset that happens to equal it (the
		// exact-pixel collision the shared register allows).
		lastSaved = -1;
		restoredPosition.value = null;
	}

	onUnmounted(() => {
		flush();
		cancelRestores?.();
		if (isClient()) window.removeEventListener("pagehide", flush);
	});
	if (isClient()) {
		window.addEventListener("pagehide", flush);
	}

	return { restoredPosition, restoring, restore, save, flush, jumpToTop, cancelRestore, reset };
}
