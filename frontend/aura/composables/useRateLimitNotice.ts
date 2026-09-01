/**
 * App-wide HTTP 429 rate-limit notice (round 211).
 *
 * slowapi returns a technical 429 (`{"detail":"Rate limit exceeded: N per
 * minute"}`) and the pages that surface it show everything from a raw-ish
 * message to a generic network error — a reader posting several comments in a
 * row, searching rapidly, or registering gets no clear "slow down" cue. The
 * transport layer (api/transport.ts) flips this module-level flag on any 429;
 * the RateLimitNotice banner renders the localized message and auto-dismisses.
 *
 * Module reactive singleton (like useRecentlyViewed/useBookmarkSync): one
 * banner reflects the most recent 429 regardless of which page triggered it,
 * and a burst of many 429s collapses into a single visible notice instead of
 * stacking. SSR-safe (never true on the server; 429s only happen client-side).
 */
import { ref } from "vue";

/** How long the banner stays visible before auto-dismissing. */
const RATE_LIMIT_VISIBLE_MS = 6000;

const active = ref(false);
let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function useRateLimitNotice() {
	/** Show (or refresh) the notice — restarting the auto-dismiss timer. */
	function show(): void {
		active.value = true;
		if (hideTimer) clearTimeout(hideTimer);
		hideTimer = setTimeout(() => {
			active.value = false;
		}, RATE_LIMIT_VISIBLE_MS);
	}

	/** Hide immediately (explicit dismiss or cleanup). */
	function dismiss(): void {
		active.value = false;
		if (hideTimer) {
			clearTimeout(hideTimer);
			hideTimer = null;
		}
	}

	return { active, show, dismiss };
}
