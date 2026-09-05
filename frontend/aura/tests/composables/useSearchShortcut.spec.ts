/**
 * Global "/" keyboard shortcut → focus the header search box (round 262).
 *
 * Verifies the pure handler (handleGlobalSearchShortcut): which events it
 * consumes, that it never steals "/" out of a typing context, that hidden
 * (CSS-not-rendered) header-search instances are skipped, and that the first
 * VISIBLE one wins. The reader layout wires it to window.onkeydown via
 * useSearchShortcut().
 */

import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleGlobalSearchShortcut, useSearchShortcut } from "../../composables/useSearchShortcut";

/** Append a `[data-header-search]` input. The visibility filter uses
 *  getClientRects(), which happy-dom cannot reflect (no layout): a real browser
 *  reports ≥1 rect only for rendered elements, so both cases are stubbed —
 *  visible → one rect, hidden → zero rects. */
function appendSearchInput(visible = true): HTMLInputElement {
	const el = document.createElement("input");
	el.setAttribute("data-header-search", "");
	document.body.appendChild(el);
	vi.spyOn(el, "getClientRects").mockReturnValue(
		(visible ? [{ width: 200, height: 24 }] : []) as unknown as DOMRectList,
	);
	return el;
}

function fireKey(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
	return new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true, ...init });
}

describe("handleGlobalSearchShortcut", () => {
	afterEach(() => {
		document.body.innerHTML = "";
		vi.restoreAllMocks();
	});

	it("focuses the visible header search and consumes the event on '/'", () => {
		const input = appendSearchInput(true);
		const focusSpy = vi.spyOn(input, "focus");
		const event = fireKey("/");
		expect(handleGlobalSearchShortcut(event)).toBe(true);
		expect(focusSpy).toHaveBeenCalledTimes(1);
		expect(event.defaultPrevented).toBe(true);
	});

	it("skips hidden search inputs and does not consume the event", () => {
		appendSearchInput(false);
		const event = fireKey("/");
		expect(handleGlobalSearchShortcut(event)).toBe(false);
		expect(event.defaultPrevented).toBe(false);
	});

	it("focuses the first VISIBLE input when several exist (desktop + mobile)", () => {
		appendSearchInput(false); // e.g. hidden desktop nav below the xl breakpoint
		const visibleMobile = appendSearchInput(true); // e.g. the open mobile menu
		appendSearchInput(false); // closed/detached instance
		const visibleDesktop = appendSearchInput(true);
		const mobileFocus = vi.spyOn(visibleMobile, "focus");
		const desktopFocus = vi.spyOn(visibleDesktop, "focus");
		expect(handleGlobalSearchShortcut(fireKey("/"))).toBe(true);
		expect(mobileFocus).toHaveBeenCalledTimes(1);
		expect(desktopFocus).not.toHaveBeenCalled();
	});

	it("ignores modifier-modified '/' (ctrl/meta/alt/shift)", () => {
		const input = appendSearchInput(true);
		const focusSpy = vi.spyOn(input, "focus");
		for (const init of [
			{ ctrlKey: true },
			{ metaKey: true },
			{ altKey: true },
			{ shiftKey: true },
		]) {
			const event = fireKey("/", init);
			expect(handleGlobalSearchShortcut(event)).toBe(false);
			expect(event.defaultPrevented).toBe(false);
		}
		expect(focusSpy).not.toHaveBeenCalled();
	});

	it("never steals '/' typed inside an editable control", () => {
		const search = appendSearchInput(true);
		const focusSpy = vi.spyOn(search, "focus");
		const field = document.createElement("input");
		document.body.appendChild(field);
		const event = fireKey("/");
		Object.defineProperty(event, "target", { value: field });
		expect(handleGlobalSearchShortcut(event)).toBe(false);
		expect(event.defaultPrevented).toBe(false);
		expect(focusSpy).not.toHaveBeenCalled();
	});

	it("ignores non-'/' keys", () => {
		const input = appendSearchInput(true);
		const focusSpy = vi.spyOn(input, "focus");
		const event = fireKey("a");
		expect(handleGlobalSearchShortcut(event)).toBe(false);
		expect(focusSpy).not.toHaveBeenCalled();
	});

	it("does nothing when no search input is mounted", () => {
		document.body.innerHTML = "";
		const event = fireKey("/");
		expect(handleGlobalSearchShortcut(event)).toBe(false);
		expect(event.defaultPrevented).toBe(false);
	});
});

describe("useSearchShortcut", () => {
	afterEach(() => {
		document.body.innerHTML = "";
		vi.restoreAllMocks();
	});

	it("wires the handler to window.keydown on mount and removes it on unmount", () => {
		const addSpy = vi.spyOn(window, "addEventListener");
		const removeSpy = vi.spyOn(window, "removeEventListener");
		const Harness = {
			setup() {
				useSearchShortcut();
				return () => null;
			},
		};
		const wrapper = mount(Harness);
		expect(addSpy).toHaveBeenCalledWith("keydown", handleGlobalSearchShortcut);

		wrapper.unmount();
		expect(removeSpy).toHaveBeenCalledWith("keydown", handleGlobalSearchShortcut);
	});
});
