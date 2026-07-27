/**
 * i18n composable tests
 * Tests the pure translation functions (localeFromPath, localizedPath,
 * createTranslator, getDictionary) and the useI18n() Vue composable.
 *
 * Ported from frontend/next/lib/i18n.test.ts with the same test coverage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	createTranslator,
	defaultLocale,
	getDictionary,
	type Locale,
	localeFromPath,
	localeNames,
	locales,
	localizedPath,
	useI18n,
} from "../../composables/useI18n.ts";

describe("localeFromPath", () => {
	it("returns en for /en/* paths", () => {
		expect(localeFromPath("/en")).toBe("en");
		expect(localeFromPath("/en/")).toBe("en");
		expect(localeFromPath("/en/about")).toBe("en");
		expect(localeFromPath("/en/posts/my-post")).toBe("en");
	});

	it("returns zh-TW for /zh-TW/* paths", () => {
		expect(localeFromPath("/zh-TW")).toBe("zh-TW");
		expect(localeFromPath("/zh-TW/")).toBe("zh-TW");
		expect(localeFromPath("/zh-TW/about")).toBe("zh-TW");
		expect(localeFromPath("/zh-TW/posts/my-post")).toBe("zh-TW");
	});

	it("returns defaultLocale for other paths", () => {
		expect(localeFromPath("/")).toBe(defaultLocale);
		expect(localeFromPath("/posts")).toBe(defaultLocale);
		expect(localeFromPath("/posts/my-post")).toBe(defaultLocale);
		expect(localeFromPath("/admin")).toBe(defaultLocale);
	});
});

describe("localizedPath", () => {
	it("returns path unchanged for default locale", () => {
		expect(localizedPath("/posts", "zh-CN")).toBe("/posts");
		expect(localizedPath("/posts/my-post", "zh-CN")).toBe("/posts/my-post");
	});

	it("prepends /en for non-default locale", () => {
		expect(localizedPath("/posts", "en")).toBe("/en/posts");
		expect(localizedPath("/posts/my-post", "en")).toBe("/en/posts/my-post");
	});

	it("handles paths without leading slash for non-default locale", () => {
		expect(localizedPath("posts", "en")).toBe("/en/posts");
		expect(localizedPath("posts", "zh-TW")).toBe("/zh-TW/posts");
	});

	it("handles already-localized paths (no dedup)", () => {
		expect(localizedPath("/en/posts", "en")).toBe("/en/en/posts");
	});

	it("prepends /zh-TW for zh-TW locale", () => {
		expect(localizedPath("/posts", "zh-TW")).toBe("/zh-TW/posts");
		expect(localizedPath("/posts/my-post", "zh-TW")).toBe("/zh-TW/posts/my-post");
	});
});

describe("getDictionary", () => {
	it("returns correct dictionary for zh-CN", () => {
		const dict = getDictionary("zh-CN");
		expect(dict["nav.home"]).toBe("首页");
		expect(dict["home.noPosts"]).toBe("暂无文章");
	});

	it("returns correct dictionary for en", () => {
		const dict = getDictionary("en");
		expect(dict["nav.home"]).toBe("Home");
		expect(dict["home.noPosts"]).toBe("No posts yet");
	});

	it("returns correct dictionary for zh-TW", () => {
		const dict = getDictionary("zh-TW");
		expect(dict["nav.home"]).toBe("首頁");
		expect(dict["home.noPosts"]).toBe("暫無文章");
	});

	it("falls back to default locale for unknown locale", () => {
		const dict = getDictionary("fr" as Locale);
		expect(dict).toEqual(getDictionary(defaultLocale));
	});
});

describe("createTranslator", () => {
	it("translates known keys for zh-CN", () => {
		const t = createTranslator("zh-CN");
		expect(t("nav.home")).toBe("首页");
		expect(t("post.views")).toBe("阅读");
		expect(t("search.noResults")).toBe("未找到相关文章");
	});

	it("translates known keys for en", () => {
		const t = createTranslator("en");
		expect(t("nav.home")).toBe("Home");
		expect(t("post.views")).toBe("views");
		expect(t("search.noResults")).toBe("No posts found");
	});

	it("translates known keys for zh-TW", () => {
		const t = createTranslator("zh-TW");
		expect(t("nav.home")).toBe("首頁");
		expect(t("post.views")).toBe("閱讀");
		expect(t("search.noResults")).toBe("未找到相關文章");
	});

	it("returns key for unknown translation key", () => {
		const t = createTranslator("zh-CN");
		expect(t("unknown.key" as never)).toBe("unknown.key");
	});

	it("replaces parameters in translations", () => {
		const t = createTranslator("zh-CN");
		expect(t("post.views" as never, { count: 42 })).toBe("阅读");
	});

	it("replaces ALL occurrences of a parameter (not just the first)", () => {
		const t = createTranslator("zh-CN");
		const result = t("comment.deleteConfirm" as never, { name: "Alice" });
		expect(result).toBe("确定删除 Alice？Alice 的评论将被永久删除。");
		expect(result).not.toContain("{name}");
	});

	it("handles missing parameters gracefully", () => {
		const t = createTranslator("en");
		expect(t("common.next" as never)).toBe("Next");
	});
});

describe("locales and defaults", () => {
	it("exports all expected locales", () => {
		expect(locales).toContain("zh-CN");
		expect(locales).toContain("en");
		expect(locales).toContain("zh-TW");
		expect(locales).toHaveLength(3);
	});

	it("exports locale names for all three locales", () => {
		expect(localeNames["zh-CN"]).toBe("中文");
		expect(localeNames.en).toBe("English");
		expect(localeNames["zh-TW"]).toBe("繁體中文");
	});

	it("defaultLocale is zh-CN", () => {
		expect(defaultLocale).toBe("zh-CN");
	});
});

// ─────────────────────────────────────────────────────────────
// useI18n() composable (Vue integration)
// ─────────────────────────────────────────────────────────────

describe("useI18n composable", () => {
	let mockNavigateTo: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		// Mock Nuxt's useCookie — returns a ref with the stored locale
		vi.stubGlobal("useCookie", (_name: string) => ({
			value: "zh-CN",
		}));

		vi.stubGlobal("useRuntimeConfig", () => ({
			public: {
				siteUrl: "http://localhost:13334",
			},
		}));

		// Mock Nuxt's useRoute — returns a route object with a path
		vi.stubGlobal("useRoute", () => ({
			path: "/posts",
			query: {},
			params: {},
		}));

		// Mock Nuxt's navigateTo
		mockNavigateTo = vi.fn();
		vi.stubGlobal("navigateTo", mockNavigateTo);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns t function that translates", () => {
		const { t } = useI18n();
		expect(t("nav.home")).toBe("首页");
		expect(t("nav.about")).toBe("关于");
	});

	it("returns the current locale", () => {
		const { locale } = useI18n();
		expect(locale.value).toBe("zh-CN");
	});

	it("returns localeNames with all three locales", () => {
		const { localeNames: names } = useI18n();
		expect(names["zh-CN"]).toBe("中文");
		expect(names.en).toBe("English");
		expect(names["zh-TW"]).toBe("繁體中文");
	});

	it("switchLocale navigates to the localized path", () => {
		const { switchLocale } = useI18n();
		switchLocale("en");
		expect(mockNavigateTo).toHaveBeenCalled();
	});
});
