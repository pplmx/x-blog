/**
 * Pure, Nuxt-free i18n core.
 *
 * Holds the locale type, bundle loading/merging, and the pure translation
 * lookup. No Nuxt `#imports` here so it is directly unit-testable in vitest.
 * `useLang()` (composables/useLang.ts) wraps this with reactive SSR-safe
 * state + persistence.
 *
 * Locale bundles live in `frontend/aura/locales/<locale>/<namespace>.json`.
 * Each file's top-level key is a globally-unique namespace (one per source
 * page/component) and holds that page's strings, e.g.
 *   locales/zh/nav.json  ->  { "nav": { "home": "首页", ... } }
 * Files are merged by namespace at module load; keys are dot-joined for
 * `translate("zh", "nav.home")`.
 */
export type Locale = "zh" | "en";

export interface LocaleOption {
	code: Locale;
	/** self name shown in the switcher, e.g. "中文" / "English" */
	native: string;
}

export const locales: LocaleOption[] = [
	{ code: "zh", native: "中文" },
	{ code: "en", native: "English" },
];

export const DEFAULT_LOCALE: Locale = "zh";

// Eagerly load every bundle once (works in Nuxt/Vite SSR + client + vitest).
const bundles = import.meta.glob("../locales/*/**.json", {
	eager: true,
	import: "default",
}) as Record<string, Record<string, Record<string, unknown>>>;

function flatten(prefix: string, obj: Record<string, unknown>, out: Record<string, string>): void {
	for (const [k, v] of Object.entries(obj)) {
		const key = prefix ? `${prefix}.${k}` : k;
		if (v !== null && typeof v === "object") {
			flatten(key, v as Record<string, unknown>, out);
		} else {
			out[key] = String(v);
		}
	}
}

function resolveBundle(locale: Locale): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [path, data] of Object.entries(bundles)) {
		if (!path.includes(`/locales/${locale}/`)) continue;
		for (const [ns, content] of Object.entries(data)) flatten(ns, content, out);
	}
	return out;
}

const table: Record<Locale, Record<string, string>> = {
	zh: resolveBundle("zh"),
	en: resolveBundle("en"),
};

/** Pure translation lookup — interpolates `{param}` placeholders. */
export function translate(
	locale: Locale,
	key: string,
	params?: Record<string, string | number>,
): string {
	const val = table[locale]?.[key];
	if (val == null) return key;
	if (!params) return val;
	return val.replace(/\{(\w+)\}/g, (m, p) => (params[p] != null ? String(params[p]) : m));
}

/** All flat keys available for a locale (parity/coverage helper). */
export function getAllKeys(locale: Locale): string[] {
	return Object.keys(table[locale] ?? {});
}

/**
 * Parity check: keys present in `locale` but missing from the other locale.
 * A non-empty result means a half-translated namespace — surfaces in tests.
 */
export function parityGap(locale: Locale): string[] {
	const other: Locale = locale === "zh" ? "en" : "zh";
	const otherIndex: Record<string, true> = Object.fromEntries(
		Object.keys(table[other] ?? {}).map((k) => [k, true]),
	);
	return getAllKeys(locale).filter((k) => !otherIndex[k]);
}

/** Map a browser language string to a supported locale, else default. */
export function detectBrowserLocale(value: string | undefined): Locale {
	if (!value) return DEFAULT_LOCALE;
	return /^zh/i.test(value) ? "zh" : "en";
}
