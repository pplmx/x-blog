/**
 * Internationalization (i18n) support for X-Blog Nuxt.
 *
 * Locale detection priority:
 * 1. URL path prefix (/en/*)
 * 2. localStorage preference (via localStorage)
 * 3. Default: zh-CN
 *
 * Usage:
 *   const { t, locale, switchLocale } = useI18n();
 *   t('nav.home')  // => "首页" or "Home"
 *
 * Ported from frontend/next/lib/i18n.ts with the same translation keys.
 */

export type Locale = "zh-CN" | "en" | "zh-TW";

export const locales: Locale[] = ["zh-CN", "en", "zh-TW"];
export const defaultLocale: Locale = "zh-CN";

export const localeNames: Record<Locale, string> = {
	"zh-CN": "中文",
	en: "English",
	"zh-TW": "繁體中文",
};

// ─────────────────────────────────────────────────────────────
// Translation dictionaries
// ─────────────────────────────────────────────────────────────

const zhCn = {
	// Navigation
	"nav.home": "首页",
	"nav.about": "关于",
	"nav.tags": "标签",
	"nav.search": "搜索",
	"nav.admin": "管理",
	// Meta
	"site.title": "X-Blog - 探索技术世界",
	"site.description": "X-Blog - 探索技术世界，分享编程心得、算法解读和项目实践经验",
	// Homepage
	"home.readMore": "阅读更多",
	"home.recentPosts": "最新文章",
	"home.popularPosts": "热门文章",
	"home.noPosts": "暂无文章",
	// Post
	"post.views": "阅读",
	"post.likes": "点赞",
	"post.updated": "更新于",
	"post.published": "发布于",
	"post.tags": "标签",
	"post.relatedPosts": "相关文章",
	"post.toc": "目录",
	// Search
	"search.placeholder": "搜索文章...",
	"search.noResults": "未找到相关文章",
	"search.results": "搜索结果",
	// Comments
	"comment.title": "评论",
	"comment.placeholder": "写下你的评论...",
	"comment.nickname": "昵称",
	"comment.email": "邮箱（不公开）",
	"comment.submit": "发表评论",
	"comment.reply": "回复",
	"comment.replyTo": "回复 {name}",
	"comment.delete": "删除",
	"comment.deleteConfirm": "确定删除 {name}？{name} 的评论将被永久删除。",
	// Tags
	"tags.title": "标签列表",
	"tags.allPosts": "全部文章",
	// About
	"about.title": "关于",
	"about.intro": "X-Blog 是一个使用 FastAPI + Nuxt 构建的现代化博客系统。",
	// Error pages
	"error.notFound": "页面不存在",
	"error.goHome": "返回首页",
	// Footer
	"footer.rss": "RSS 订阅",
	"footer.copyright": "© 2024 X-Blog. All rights reserved.",
	// Common
	"common.loading": "加载中...",
	"common.prev": "上一页",
	"common.next": "下一页",
	"common.submit": "提交",
	"common.cancel": "取消",
} as const;

const en = {
	// Navigation
	"nav.home": "Home",
	"nav.about": "About",
	"nav.tags": "Tags",
	"nav.search": "Search",
	"nav.admin": "Admin",
	// Meta
	"site.title": "X-Blog - Explore the Tech World",
	"site.description":
		"X-Blog - Explore the tech world, share programming insights, algorithm explanations, and project experiences.",
	// Homepage
	"home.readMore": "Read more",
	"home.recentPosts": "Recent Posts",
	"home.popularPosts": "Popular Posts",
	"home.noPosts": "No posts yet",
	// Post
	"post.views": "views",
	"post.likes": "likes",
	"post.updated": "Updated",
	"post.published": "Published",
	"post.tags": "Tags",
	"post.relatedPosts": "Related Posts",
	"post.toc": "Table of Contents",
	// Search
	"search.placeholder": "Search posts...",
	"search.noResults": "No posts found",
	"search.results": "Search Results",
	// Comments
	"comment.title": "Comments",
	"comment.placeholder": "Write your comment...",
	"comment.nickname": "Nickname",
	"comment.email": "Email (not public)",
	"comment.submit": "Post Comment",
	"comment.reply": "Reply",
	"comment.replyTo": "Reply to {name}",
	"comment.delete": "Delete",
	"comment.deleteConfirm": "Delete {name}? The comment by {name} will be permanently deleted.",
	// Tags
	"tags.title": "Tags",
	"tags.allPosts": "All Posts",
	// About
	"about.title": "About",
	"about.intro": "X-Blog is a modern blog system built with FastAPI + Nuxt.",
	// Error pages
	"error.notFound": "Page Not Found",
	"error.goHome": "Go Home",
	// Footer
	"footer.rss": "RSS Feed",
	"footer.copyright": "© 2024 X-Blog. All rights reserved.",
	// Common
	"common.loading": "Loading...",
	"common.prev": "Previous",
	"common.next": "Next",
	"common.submit": "Submit",
	"common.cancel": "Cancel",
} as const;

const zhTw = {
	// Navigation
	"nav.home": "首頁",
	"nav.about": "關於",
	"nav.tags": "標籤",
	"nav.search": "搜尋",
	"nav.admin": "管理",
	// Meta
	"site.title": "X-Blog - 探索技術世界",
	"site.description": "X-Blog - 探索技術世界，分享程式心得、演算法解譯和項目實踐經驗",
	// Homepage
	"home.readMore": "閱讀更多",
	"home.recentPosts": "最新文章",
	"home.popularPosts": "熱門文章",
	"home.noPosts": "暫無文章",
	// Post
	"post.views": "閱讀",
	"post.likes": "點讚",
	"post.updated": "更新於",
	"post.published": "發布於",
	"post.tags": "標籤",
	"post.relatedPosts": "相關文章",
	"post.toc": "目錄",
	// Search
	"search.placeholder": "搜尋文章...",
	"search.noResults": "未找到相關文章",
	"search.results": "搜尋結果",
	// Comments
	"comment.title": "評論",
	"comment.placeholder": "寫下你的評論...",
	"comment.nickname": "暱稱",
	"comment.email": "郵箱（不公開）",
	"comment.submit": "發表評論",
	"comment.reply": "回覆",
	"comment.replyTo": "回覆 {name}",
	"comment.delete": "刪除",
	"comment.deleteConfirm": "確定刪除 {name}？{name} 的評論將被永久刪除。",
	// Tags
	"tags.title": "標籤列表",
	"tags.allPosts": "全部文章",
	// About
	"about.title": "關於",
	"about.intro": "X-Blog 是一個使用 FastAPI + Nuxt 构建的現代化博客系統。",
	// Error pages
	"error.notFound": "頁面不存在",
	"error.goHome": "返回首頁",
	// Footer
	"footer.rss": "RSS 訂閱",
	"footer.copyright": "© 2024 X-Blog. All rights reserved.",
	// Common
	"common.loading": "加載中...",
	"common.prev": "上一頁",
	"common.next": "下一頁",
	"common.submit": "提交",
	"common.cancel": "取消",
} as const;

const dictionaries: Record<Locale, Record<string, string>> = {
	"zh-CN": zhCn,
	en,
	"zh-TW": zhTw,
};

// ─────────────────────────────────────────────────────────────
// Public API (pure functions, no Nuxt dependencies)
// ─────────────────────────────────────────────────────────────

export type TranslationKey = keyof typeof zhCn;

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

/** Get the localized path (prepends /locale if locale is non-default). */
export function localizedPath(path: string, locale: Locale): string {
	if (locale === defaultLocale) return path;
	// Remove leading slash if present
	const cleanPath = path.startsWith("/") ? path.slice(1) : path;
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
