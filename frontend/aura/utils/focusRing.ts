/**
 * Tab-order hand-off helpers for popovers that close on Tab.
 *
 * The naive "close, then let native Tab continue" pattern breaks under a CSS
 * leave transition: the popover lingers in the DOM until `transitionend`
 * (~150ms) after `open` flips, so the browser's (or a nextTick's) Tab scan
 * still sees the menu items and re-targets one of them — which unmounts a
 * moment later and drops focus to <body>. Handing focus off explicitly, with
 * the departing popover subtree excluded from the scan, keeps the keyboard
 * user on the page's real next control regardless of transition timing.
 */

/** Focusable elements in document tab order (same set as native Tab uses). */
export const FOCUSABLE_SELECTOR =
	'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export interface NextFocusableOptions {
	/** Subtree to exclude from the scan — e.g. a popover mid-leave-transition.
	 * Its descendants are excluded too, but `from` is still found even when it
	 * lives inside `exclude`. */
	exclude?: HTMLElement | null;
	/** Set to move focus to the element BEFORE `from` instead (Shift+Tab). */
	shift?: boolean;
}

/**
 * The element focus should move to when leaving a popover via Tab: the next
 * (shift → previous) focusable after `from` in document order, skipping
 * everything inside `exclude`. Returns `from` itself when there is no
 * candidate on the requested side (callers then leave focus where it is).
 */
export function nextFocusable(
	from: HTMLElement | null | undefined,
	options: NextFocusableOptions = {},
): HTMLElement {
	const { exclude = null, shift = false } = options;
	const all = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
		(el) => !(exclude && el !== from && exclude.contains(el)),
	);
	const idx = from ? all.indexOf(from) : -1;
	return all[shift ? idx - 1 : idx + 1] ?? from ?? document.body;
}
