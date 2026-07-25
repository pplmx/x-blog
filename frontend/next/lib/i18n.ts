/** Internationalization (i18n) support for X-Blog.
 *
 * Locale detection priority:
 * 1. URL path prefix (/en/*)
 * 2. localStorage preference
 * 3. Default: zh-CN
 *
 * Usage:
 *   import { useTranslations } from '@/lib/use-translations';
 *   const t = useTranslations();
 *   t('nav.home')  // => "首页" or "Home"
 */

export type Locale = 'zh-CN' | 'en';

export const locales: Locale[] = ['zh-CN', 'en'];
export const defaultLocale: Locale = 'zh-CN';

export const localeNames: Record<Locale, string> = {
  'zh-CN': '中文',
  en: 'English',
};

export type { Locale };

// ─────────────────────────────────────────────────────────────
// Translation dictionaries
// ─────────────────────────────────────────────────────────────

const zhCN = {
  // Navigation
  'nav.home': '首页',
  'nav.about': '关于',
  'nav.tags': '标签',
  'nav.search': '搜索',
  'nav.admin': '管理',
  // Meta
  'site.title': 'X-Blog - 探索技术世界',
  'site.description': 'X-Blog - 探索技术世界，分享编程心得、算法解读和项目实践经验',
  // Homepage
  'home.readMore': '阅读更多',
  'home.recentPosts': '最新文章',
  'home.popularPosts': '热门文章',
  'home.noPosts': '暂无文章',
  // Post
  'post.views': '阅读',
  'post.likes': '点赞',
  'post.updated': '更新于',
  'post.published': '发布于',
  'post.tags': '标签',
  'post.relatedPosts': '相关文章',
  'post.toc': '目录',
  // Search
  'search.placeholder': '搜索文章...',
  'search.noResults': '未找到相关文章',
  'search.results': '搜索结果',
  // Comments
  'comment.title': '评论',
  'comment.placeholder': '写下你的评论...',
  'comment.nickname': '昵称',
  'comment.email': '邮箱（不公开）',
  'comment.submit': '发表评论',
  'comment.reply': '回复',
  'comment.delete': '删除',
  // Tags
  'tags.title': '标签列表',
  'tags.allPosts': '全部文章',
  // About
  'about.title': '关于',
  'about.intro': 'X-Blog 是一个使用 FastAPI + Next.js 构建的现代化博客系统。',
  // Error pages
  'error.notFound': '页面不存在',
  'error.goHome': '返回首页',
  // Footer
  'footer.rss': 'RSS 订阅',
  'footer.copyright': '© 2024 X-Blog. All rights reserved.',
  // Common
  'common.loading': '加载中...',
  'common.prev': '上一页',
  'common.next': '下一页',
  'common.submit': '提交',
  'common.cancel': '取消',
} as const;

const en = {
  // Navigation
  'nav.home': 'Home',
  'nav.about': 'About',
  'nav.tags': 'Tags',
  'nav.search': 'Search',
  'nav.admin': 'Admin',
  // Meta
  'site.title': 'X-Blog - Explore the Tech World',
  'site.description':
    'X-Blog - Explore the tech world, share programming insights, algorithm explanations, and project experiences.',
  // Homepage
  'home.readMore': 'Read more',
  'home.recentPosts': 'Recent Posts',
  'home.popularPosts': 'Popular Posts',
  'home.noPosts': 'No posts yet',
  // Post
  'post.views': 'views',
  'post.likes': 'likes',
  'post.updated': 'Updated',
  'post.published': 'Published',
  'post.tags': 'Tags',
  'post.relatedPosts': 'Related Posts',
  'post.toc': 'Table of Contents',
  // Search
  'search.placeholder': 'Search posts...',
  'search.noResults': 'No posts found',
  'search.results': 'Search Results',
  // Comments
  'comment.title': 'Comments',
  'comment.placeholder': 'Write your comment...',
  'comment.nickname': 'Nickname',
  'comment.email': 'Email (not public)',
  'comment.submit': 'Post Comment',
  'comment.reply': 'Reply',
  'comment.delete': 'Delete',
  // Tags
  'tags.title': 'Tags',
  'tags.allPosts': 'All Posts',
  // About
  'about.title': 'About',
  'about.intro': 'X-Blog is a modern blog system built with FastAPI + Next.js.',
  // Error pages
  'error.notFound': 'Page Not Found',
  'error.goHome': 'Go Home',
  // Footer
  'footer.rss': 'RSS Feed',
  'footer.copyright': '© 2024 X-Blog. All rights reserved.',
  // Common
  'common.loading': 'Loading...',
  'common.prev': 'Previous',
  'common.next': 'Next',
  'common.submit': 'Submit',
  'common.cancel': 'Cancel',
} as const;

const dictionaries: Record<Locale, typeof zhCN> = {
  'zh-CN': zhCN,
  en,
};

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

export type TranslationKey = keyof typeof zhCN;

/** Get the translation dictionary for a locale. */
export function getDictionary(locale: Locale) {
  return dictionaries[locale] ?? dictionaries[defaultLocale];
}

/** Type-safe translation function. */
export type Translator = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** Create a translator for a specific locale. */
export function createTranslator(locale: Locale): Translator {
  const dict = getDictionary(locale);
  return (key, params) => {
    let text = dict[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, String(v));
      }
    }
    return text;
  };
}

/** Detect locale from pathname. */
export function localeFromPath(pathname: string): Locale {
  const segments = pathname.split('/').filter(Boolean);
  const first = segments[0];
  if (first === 'en') return 'en';
  return defaultLocale;
}

/** Get the localized path (prepends /en if locale is English). */
export function localizedPath(path: string, locale: Locale): string {
  if (locale === defaultLocale) return path;
  // Remove leading slash if present
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  return `/en/${cleanPath}`;
}
