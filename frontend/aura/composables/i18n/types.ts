/**
 * Type definitions for X-Blog i18n.
 */

export type Locale = "zh-CN" | "en" | "zh-TW";

export const locales: Locale[] = ["zh-CN", "en", "zh-TW"];
export const defaultLocale: Locale = "zh-CN";

export const localeNames: Record<Locale, string> = {
	"zh-CN": "中文",
	en: "English",
	"zh-TW": "繁體中文",
};

// Re-exported from locales/zh-CN.ts to keep TranslationKey available
// from the same module as other type definitions.
export type { TranslationKey } from "./locales/zh-CN";
