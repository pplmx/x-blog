import { type Ref, ref, watch } from "vue";
import { detectBrowserLocale, type Locale, type LocaleOption, locales, translate } from "./i18n";

/**
 * Reactive, SSR-safe i18n wrapper around the pure core (composables/i18n.ts).
 *
 * The locale lives in a Nuxt `useState`-backed singleton so it is shared by
 * every component that calls `useLang()` (a switcher click re-renders the
 * whole tree) yet stays per-request isolated on the server. Falls back to a
 * plain module-scoped ref in vitest (no Node `useState` present).
 *
 * SSR-safe: the initial locale comes from the `lang` cookie so server HTML
 * matches client preference (no flash). Persistent + auto-detect on first
 * visit (no cookie). `<html lang>` is synced in app.vue.
 */
const STATE_KEY = "xblog.lang";

const canUseNuxt = (): boolean => typeof useState === "function" && typeof useCookie === "function";

function initialLocale(cookie?: { value?: Locale }): Locale {
	const v = cookie?.value;
	if (v === "zh" || v === "en") return v;
	return detectBrowserLocale(
		typeof window !== "undefined" ? (window.navigator?.language ?? "") : "",
	);
}

const updateDomLang = (l: Locale): void => {
	if (typeof document === "undefined") return;
	document.documentElement.lang = l;
};

export function useLang(): {
	locale: Ref<Locale>;
	setLocale: (l: Locale) => void;
	t: (key: string, params?: Record<string, string | number>) => string;
	locales: LocaleOption[];
} {
	const cookie = canUseNuxt() ? useCookie<Locale>("lang") : null;

	const locale: Ref<Locale> =
		typeof useState === "function"
			? useState<Locale>(STATE_KEY, () => initialLocale(cookie as { value?: Locale }))
			: ref<Locale>(initialLocale());

	// Persist + sync DOM on change (in Nuxt the cookie is the persistence
	// sink; in vitest there is none, so only the DOM sync applies here).
	watch(locale, (l) => {
		if (cookie) cookie.value = l;
		updateDomLang(l);
	});

	// Ensure DOM lang matches on mount (covers first-visit no-cookie path).
	if (typeof window !== "undefined") {
		updateDomLang(locale.value);
	}

	function setLocale(l: Locale): void {
		locale.value = l;
	}

	function t(key: string, params?: Record<string, string | number>): string {
		return translate(locale.value, key, params);
	}

	return { locale, setLocale, t, locales };
}
