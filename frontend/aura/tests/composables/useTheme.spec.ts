/**
 * useTheme singleton tests — the dark/light preference is shared between the
 * public and admin layouts (deep-dive: the admin UI had no control and never
 * applied the saved preference). initTheme must honor the persisted value,
 * fall back to the system preference, and the toggle must persist + flip the
 * <html> class.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { useTheme } from "../../composables/useTheme";

const matchMediaMock = vi.fn();

function mountTheme(themeSaved: string | null, systemDark = false) {
	if (themeSaved === null) localStorage.removeItem("theme");
	else localStorage.setItem("theme", themeSaved);
	matchMediaMock.mockReturnValue({
		matches: systemDark,
		media: "",
		onchange: null,
		addEventListener: vi.fn(),
	});
	window.matchMedia = matchMediaMock as unknown as typeof window.matchMedia;
	return useTheme();
}

describe("useTheme", () => {
	beforeEach(() => {
		localStorage.clear();
		document.documentElement.classList.remove("dark");
		matchMediaMock.mockReset();
	});

	afterEach(() => {
		localStorage.clear();
		document.documentElement.classList.remove("dark");
	});

	it("applies a persisted dark preference on init", () => {
		const { isDark, initTheme } = mountTheme("dark");
		initTheme();
		expect(isDark.value).toBe(true);
		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});

	it("applies a persisted light preference on init", () => {
		const { isDark, initTheme } = mountTheme("light");
		initTheme();
		expect(isDark.value).toBe(false);
		expect(document.documentElement.classList.contains("dark")).toBe(false);
	});

	it("falls back to the system dark preference when nothing is saved", () => {
		const { isDark, initTheme } = mountTheme(null, true);
		initTheme();
		expect(isDark.value).toBe(true);
	});

	it("toggles dark mode, persists it, and flips the html class", async () => {
		const { isDark, initTheme, toggleTheme } = mountTheme("light");
		initTheme();
		expect(isDark.value).toBe(false);

		toggleTheme();
		// persistence + class apply via the (async) internal watch
		await nextTick();
		expect(isDark.value).toBe(true);
		expect(localStorage.getItem("theme")).toBe("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);

		toggleTheme();
		await nextTick();
		expect(isDark.value).toBe(false);
		expect(localStorage.getItem("theme")).toBe("light");
		expect(document.documentElement.classList.contains("dark")).toBe(false);
	});
});
