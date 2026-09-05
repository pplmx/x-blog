/**
 * Global "/" → focus the header search box (round 262, TASK-279).
 *
 * The GitHub/forum convention: pressing "/" anywhere on a reader page drops
 * the reader into the site search, so they can start typing a query without
 * tabbing through the whole header. The handler is deliberately narrow:
 *   - only an unmodified "/" (ctrl/meta/alt/shift variants pass through);
 *   - never steals "/" out of an editable control — typing "/" inside an
 *     input/textarea/select/contenteditable keeps working normally;
 *   - only targets a VISIBLE header-search input. The layout renders up to two
 *     HeaderSearch instances (the desktop nav and the mobile menu), exactly one
 *     of which is visible at any width; hidden (display:none) instances report
 *     no client rects and are skipped, so the first visible one is focused.
 *
 * The reader layout installs the listener once via useSearchShortcut() (the
 * admin layout has no header search and deliberately does not install it).
 */

import { onMounted, onUnmounted } from "vue";

const SEARCH_SELECTOR = "[data-header-search]";

/** True while the event's target is somewhere the reader is typing. */
function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	const tag = target.tagName;
	return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/** Header-search inputs that are actually rendered (not display:none). */
function visibleSearchInputs(): HTMLInputElement[] {
	if (typeof document === "undefined") return [];
	return Array.from(document.querySelectorAll<HTMLInputElement>(SEARCH_SELECTOR)).filter(
		(el) => el.getClientRects().length > 0,
	);
}

/**
 * Handle a "/" shortcut press. Returns true when the event was consumed (a
 * visible header search was focused and the default action swallowed so "/"
 * doesn't leak into the page); false leaves the event untouched.
 */
export function handleGlobalSearchShortcut(event: KeyboardEvent): boolean {
	if (event.key !== "/") return false;
	if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
	if (isEditableTarget(event.target)) return false;
	const input = visibleSearchInputs()[0];
	if (!input) return false;
	input.focus();
	event.preventDefault();
	return true;
}

/**
 * Install the window keydown listener for the "/" shortcut. Idempotent: the
 * reader layout remounts (route changes keep it alive, but SPA edge paths can
 * mount twice), and a second install must not double-fire the handler.
 */
export function useSearchShortcut(): void {
	let installed = false;
	onMounted(() => {
		if (installed) return;
		installed = true;
		window.addEventListener("keydown", handleGlobalSearchShortcut);
	});
	onUnmounted(() => {
		installed = false;
		window.removeEventListener("keydown", handleGlobalSearchShortcut);
	});
}
