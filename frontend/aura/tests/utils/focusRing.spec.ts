/**
 * nextFocusable unit tests.
 *
 * The production bug this guards (round-300 review): LanguageSwitcher's Tab
 * hand-off runs on nextTick, but the popover is inside a CSS leave transition
 * (~150ms) at that moment — it is STILL in the document, so any scan that does
 * not exclude it would re-target a menuitem that unmounts a moment later,
 * dropping focus to <body>. happy-dom can't reproduce the transition-live DOM,
 * so the component-level tests alone would stay green even for that broken
 * path; these tests drive the helper directly with the popover PRESENT.
 */

import { afterEach, describe, expect, it } from "vitest";

import { nextFocusable } from "../../utils/focusRing";

const cleanup: Array<() => void> = [];
afterEach(() => {
	for (const fn of cleanup.splice(0)) fn();
});

/** Build the header-row-like DOM [... before, trigger, popover, after]. */
function setup(options: { hasAfter?: boolean; hasBefore?: boolean } = {}) {
	const { hasAfter = true, hasBefore = true } = options;
	const root = document.createElement("div");
	document.body.appendChild(root);
	if (hasBefore) {
		const before = document.createElement("button");
		before.textContent = "before";
		root.appendChild(before);
	}
	const trigger = document.createElement("button");
	trigger.textContent = "trigger";
	root.appendChild(trigger);
	// A popover mid-leave-transition: still in the document (the browser path).
	const popover = document.createElement("div");
	popover.setAttribute("role", "menu");
	const item1 = document.createElement("button");
	item1.textContent = "item1";
	const item2 = document.createElement("button");
	item2.textContent = "item2";
	popover.append(item1, item2);
	root.appendChild(popover);
	if (hasAfter) {
		const after = document.createElement("button");
		after.textContent = "after";
		root.appendChild(after);
	}
	cleanup.push(() => root.remove());
	return { trigger, popover, item1, item2 };
}

describe("nextFocusable", () => {
	it("skips a popover still in the DOM and hands focus to the real next control", () => {
		const { trigger, popover, item2 } = setup();
		// The popover is PRESENT — the transition-live condition happy-dom
		// cannot model. Next must be AFTER the menu, never item1/item2.
		const next = nextFocusable(trigger, { exclude: popover });
		expect(next).not.toBe(item2);
		expect(next.textContent).toBe("after");
	});

	it("skips the popover on Shift+Tab too, handing focus to the control before the trigger", () => {
		const { trigger, popover } = setup();
		expect(nextFocusable(trigger, { exclude: popover, shift: true }).textContent).toBe("before");
	});

	it("excludes every focusable inside the popover, not just the first", () => {
		const { trigger, popover, item1, item2 } = setup();
		// Forward from the LAST popover item must land on the after-control, so
		// both item1 and item2 are skipped.
		expect(nextFocusable(item2, { exclude: popover }).textContent).toBe("after");
		expect(nextFocusable(item1, { exclude: popover }).textContent).toBe("after");
	});

	it("returns the trigger itself at the end of tab order (no candidate)", () => {
		const { trigger, popover } = setup({ hasAfter: false });
		expect(nextFocusable(trigger, { exclude: popover })).toBe(trigger);
	});

	it("ignores a stale exclude when the popover is already gone", () => {
		const { trigger, popover } = setup();
		// happy-dom / fast transition: the node was removed but the captured
		// reference is still passed; the scan must fall through to 'after'.
		popover.remove();
		expect(nextFocusable(trigger, { exclude: popover }).textContent).toBe("after");
	});
});
