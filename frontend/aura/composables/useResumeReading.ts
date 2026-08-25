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
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let cancelRestores: (() => void) | null = null;
	// While non-zero, scroll events are ignored (used briefly after the
	// back-to-top wipe so the smooth animation's intermediate offsets cannot
	// write a stale position back over the explicit 0).
	let suppressSavesUntil = 0;

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

	async function restore(): Promise<number | null> {
		const id = activePostId();
		if (!id) return null;
		restoring.value = true;
		try {
			const data = await getReaderReadingPosition(id);
			const pos = data?.scroll_position ?? null;
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
			restoring.value = false;
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
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			saveTimer = null;
			if (pendingPos == null || pendingPos === lastSaved) return;
			lastSaved = pendingPos;
			recordReaderHistory(id, pendingPos).catch(() => {});
			pendingPos = null;
		}, SAVE_DEBOUNCE_MS);
	}

	function flush(): void {
		const id = activePostId();
		const pos = pendingPos;
		pendingPos = null;
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
		if (!id || pos == null || pos < MIN_SAVE_PX || pos === lastSaved) return;
		lastSaved = pos;
		recordReaderHistory(id, pos).catch(() => {});
	}

	function jumpToTop(): void {
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
			recordReaderHistory(id, 0).catch(() => {});
			// The smooth scroll still fires scroll events for ~a second; ignore
			// them so an intermediate offset cannot write over the clear.
			suppressSavesUntil = Date.now() + 1500;
		}
	}

	/** Drop any scheduled/tracked save without writing it (used when changing
	 * posts or jumping back to the top, where the residual offset is stale). */
	function clearPendingSave(): void {
		pendingPos = null;
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
	}

	function cancelRestore(): void {
		cancelRestores?.();
	}

	function reset(): void {
		cancelRestores?.();
		suppressSavesUntil = 0;
		clearPendingSave();
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
