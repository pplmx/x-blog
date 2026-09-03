/**
 * Dark/light theme (module singleton shared by the public AND admin layouts).
 *
 * The admin layout previously had no theme control and never applied the saved
 * preference, so a dark-mode admin (whose public-layout toggle persisted
 * "theme":"dark") was stranded in light mode on every /admin/* page. Both
 * layouts now init from useTheme(): the persisted preference / system
 * preference is applied in both, `dark` class toggles are shared on
 * <html>, and the public toggle flips the admin UI too.
 */
import { ref, watch } from "vue";

const isDark = ref(false);

function updateDarkClass(): void {
	if (typeof document === "undefined") return;
	document.documentElement.classList.toggle("dark", isDark.value);
}

/**
 * Apply the persisted / system theme on mount (SSR-safe), then keep
 * localStorage in sync with every toggle. idempotent-per-call.
 */
function storage(): Storage | null {
	return typeof localStorage !== "undefined" ? localStorage : null;
}

function initTheme(): void {
	if (typeof window === "undefined") return;
	try {
		// Bare `localStorage` (not window.localStorage) so SSR-safe guards and
		// test-world stubs agree with the rest of the codebase, which reads the
		// same "theme" key.
		const saved = storage()?.getItem("theme");
		if (saved === "dark") isDark.value = true;
		else if (saved === "light") isDark.value = false;
		else if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) isDark.value = true;
	} catch {
		isDark.value = false;
	}
	updateDarkClass();
	watch(isDark, (v) => {
		updateDarkClass();
		try {
			storage()?.setItem("theme", v ? "dark" : "light");
		} catch {
			// Storage unavailable (private mode) — the class still applies.
		}
	});
}

function toggleTheme(): void {
	isDark.value = !isDark.value;
}

export function useTheme() {
	return { isDark, initTheme, toggleTheme };
}
