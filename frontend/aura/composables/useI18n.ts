/**
 * Internationalization (i18n) support for X-Blog Nuxt.
 *
 * Locale detection priority:
 * 1. URL path prefix (/en/*, /zh-TW/*)
 * 2. Cookie preference (locale)
 * 3. Default: zh-CN
 *
 * Usage:
 *   const { t, locale, switchLocale } = useI18n();
 *   t('nav.home')  // => "首页" / "Home" / "首頁"
 *
 * Translation dictionaries are in ./i18n/locales/
 * Type definitions are in ./i18n/types
 *
 * Ported from frontend/next/lib/i18n.ts with the same translation keys.
 */

// ─── Translation dictionaries ───────────────────────────────────────
import { en } from "./i18n/locales/en";
import { zhCn } from "./i18n/locales/zh-CN";
import { zhTw } from "./i18n/locales/zh-TW";
// ─── Types ───────────────────────────────────────────────────────────
import type { Locale, TranslationKey } from "./i18n/types";
import { defaultLocale, localeNames, locales } from "./i18n/types";

const dictionaries: Record<Locale, Record<string, string>> = {
	"zh-CN": zhCn,
	en,
	"zh-TW": zhTw,
};

// ─────────────────────────────────────────────────────────────
// Public API (pure functions, no Nuxt dependencies)
// ─────────────────────────────────────────────────────────────

/** Type-safe translation function. */
export type Translator = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** Get the translation dictionary for a locale. */
export function getDictionary(locale: Locale): Record<string, string> {
	return dictionaries[locale] ?? dictionaries[defaultLocale];
}

/** Create a translator for a specific locale. */
export function createTranslator(locale: Locale): Translator {
	const dict = getDictionary(locale);
	return (key, params) => {
		let text = dict[key] ?? key;
		if (params) {
			for (const [k, v] of Object.entries(params)) {
				// Use replaceAll to replace ALL occurrences of a placeholder,
				// not just the first (String.replace only replaces the first match).
				text = text.replaceAll(`{${k}}`, String(v));
			}
		}
		return text;
	};
}

/** Detect locale from pathname. */
export function localeFromPath(pathname: string): Locale {
	const segments = pathname.split("/").filter(Boolean);
	const first = segments[0];
	if (first && locales.includes(first as Locale)) return first as Locale;
	return defaultLocale;
}

/**
 * Get the localized path (prepends /locale if locale is non-default).
 *
 * Strips an existing locale prefix to prevent double-prefixing (e.g.,
 * switching from /en/posts to "en" yields /en/posts, not /en/en/posts).
 */
export function localizedPath(path: string, locale: Locale): string {
	if (locale === defaultLocale) return path;
	// Remove leading slash if present
	let cleanPath = path.startsWith("/") ? path.slice(1) : path;
	// Strip existing locale prefix to avoid double-prefixing
	const segments = cleanPath.split("/");
	if (segments[0] && locales.includes(segments[0] as Locale)) {
		segments.shift();
	}
	cleanPath = segments.join("/");
	return `/${locale}/${cleanPath}`;
}

// ─────────────────────────────────────────────────────────────
// Vue composable (uses Nuxt built-ins)
// ─────────────────────────────────────────────────────────────

/**
 * useI18n() — reactive i18n composable for Vue components.
 *
 * Returns a translator function and locale state. Locale is detected
 * from the URL path prefix, falling back to the cookie preference,
 * then to the default locale.
 *
 * @returns {{ t: Translator, locale: Ref<Locale>, switchLocale: (locale: Locale) => void, localeNames: Record<Locale, string> }}
 */
export function useI18n() {
	// Detect locale from current route path
	const route = useRoute();
	const pathLocale = localeFromPath(route.path);

	// Use a cookie to persist the user's locale preference
	const localeCookie = useCookie<Locale>("locale", {
		default: () => pathLocale,
	});

	// Reactive locale: prefer cookie, fall back to path detection
	const locale = computed(() => localeCookie.value || pathLocale);

	// Create a translator for the current locale
	const t = computed(() => createTranslator(locale.value));

	/** Switch to a different locale and navigate to the localized path. */
	function switchLocale(target: Locale) {
		// Update the cookie
		localeCookie.value = target;
		// Navigate to the localized version of the current page
		const targetPath = localizedPath(route.path, target);
		navigateTo(targetPath);
	}

	return {
		t: (key: TranslationKey, params?: Record<string, string | number>) => t.value(key, params),
		locale,
		switchLocale,
		localeNames,
	};
}

// ─────────────────────────────────────────────────────────────
// Re-exports (backward compatibility)
// ─────────────────────────────────────────────────────────────

export type { Locale, TranslationKey };
export { defaultLocale, localeNames, locales };
