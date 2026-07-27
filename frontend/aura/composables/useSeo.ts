/**
 * SEO composable for X-Blog.
 *
 * Centralizes site-wide SEO configuration, canonical URL generation,
 * complete meta tag assembly, and JSON-LD structured data helpers.
 *
 * Usage in a page's <script setup>:
 *   useSeo({
 *     title: "My Post",
 *     description: "Post excerpt...",
 *     path: "/posts/my-post",
 *   });
 *
 *   // With article structured data:
 *   useSeo({
 *     title: "My Post",
 *     description: "Post excerpt...",
 *     path: "/posts/my-post",
 *     image: "https://example.com/og.png",
 *     article: {
 *       datePublished: "2024-01-01T00:00:00Z",
 *       dateModified: "2024-01-02T00:00:00Z",
 *       author: "X-Blog",
 *       section: "Tech",
 *       tags: ["React", "TypeScript"],
 *     },
 *   });
 *
 *   // For a blog post (accepts the Post object from useApi):
 *   usePostSeo(post);
 */

// ─── Types ───────────────────────────────────────────────────────────

/** Minimum post data needed for SEO (matches the Post interface in useApi.ts). */
export interface SeoPostData {
	id: number;
	title: string;
	slug: string;
	excerpt: string | null;
	created_at: string;
	updated_at: string;
	cover_image: string | null;
	category: { id: number; name: string } | null;
	tags: { id: number; name: string }[];
}

/** Article metadata for JSON-LD BlogPosting schema. */
export interface ArticleMetadata {
	datePublished: string;
	dateModified: string;
	author: string;
	section: string;
	tags?: string[];
}

/** Options for useSeo(). */
export interface SeoOptions {
	/** Page title (used for <title> and og:title). */
	title: string;
	/** Page description (used for meta description and og:description). */
	description?: string;
	/** Page path relative to site root, e.g. "/posts/my-post". */
	path?: string;
	/** Social share image URL (absolute or relative). */
	image?: string;
	/** Article metadata — when provided, og:type becomes "article" and JSON-LD is emitted. */
	article?: ArticleMetadata;
	/** Tags for keywords meta and JSON-LD. */
	tags?: string[];
	/** When true, adds robots meta "noindex, follow". */
	noindex?: boolean;
}

// ─── Site config ─────────────────────────────────────────────────────

/** Site-wide SEO configuration shared across all pages and helpers. */
export const siteConfig = {
	name: "X-Blog",
	title: "X-Blog — 一个现代化的技术博客系统",
	description:
		"X-Blog 是一个基于 FastAPI + Nuxt 的现代化技术博客系统，支持 Markdown、Mermaid 图表、KaTeX 数学公式、代码高亮、文章分类、标签管理、阅读计数、点赞评论等功能。",
	image: "/logo.png",
	locale: "zh_CN",
	twitterHandle: "@x_blog",
};

// ─── Pure builders (no Nuxt dependencies, fully testable) ───────────

/** Default fallback site URL used when runtime config is unavailable. */
export const DEFAULT_SITE_URL = "http://localhost:3000";

/**
 * Build an absolute canonical URL from a site URL and path.
 * Strips trailing slashes (except for the root path).
 */
export function buildCanonicalUrl(path: string, siteUrl?: string): string {
	const base = siteUrl && siteUrl.length > 0 ? siteUrl : DEFAULT_SITE_URL;
	const cleanPath = path.startsWith("/") ? path : `/${path}`;
	const normalized =
		cleanPath !== "/" && cleanPath.endsWith("/") ? cleanPath.slice(0, -1) : cleanPath;
	return `${base}${normalized}`;
}

/**
 * Resolve a relative image URL to an absolute URL using the site URL.
 * Absolute URLs (http:// or https://) are returned as-is.
 */
export function buildAbsoluteImageUrl(image: string, siteUrl?: string): string {
	if (!image || image.length === 0) return "";
	if (image.startsWith("http://") || image.startsWith("https://")) return image;
	const base = siteUrl && siteUrl.length > 0 ? siteUrl : DEFAULT_SITE_URL;
	return `${base}${image.startsWith("/") ? image : `/${image}`}`;
}

/**
 * Build a canonical <link> object for useHead.
 */
export function buildCanonicalLink(url: string): { rel: string; href: string } {
	return { rel: "canonical", href: url };
}

/**
 * Build BlogPosting JSON-LD structured data for a blog post.
 *
 * @param post        Post data (SeoPostData matching the Post interface)
 * @param options     Additional options: url, siteName, locale
 */
export function buildArticleJsonLd(
	post: SeoPostData,
	options: { url: string; siteName: string; locale?: string },
): Record<string, unknown> {
	return {
		"@context": "https://schema.org",
		"@type": "BlogPosting",
		headline: post.title,
		description: post.excerpt || "",
		image: post.cover_image || undefined,
		author: {
			"@type": "Person",
			name: options.siteName,
		},
		publisher: {
			"@type": "Organization",
			name: options.siteName,
			logo: {
				"@type": "ImageObject",
				url: siteConfig.image,
			},
		},
		datePublished: post.created_at,
		dateModified: post.updated_at,
		mainEntityOfPage: {
			"@type": "WebPage",
			"@id": options.url,
		},
		articleSection: post.category?.name || "Blog",
		keywords: post.tags.map((t) => t.name).join(", "),
	};
}

/**
 * Build WebSite JSON-LD structured data for the site (global, site-wide).
 */
export function buildSiteJsonLd(options: {
	url: string;
	siteName: string;
	description: string;
}): Record<string, unknown> {
	return {
		"@context": "https://schema.org",
		"@type": "WebSite",
		name: options.siteName,
		description: options.description,
		url: options.url,
		publisher: {
			"@type": "Organization",
			name: options.siteName,
		},
	};
}

// ─── Composables (use Nuxt built-ins) ────────────────────────────────

/**
 * Get the site URL from runtime config.
 * Defaults to http://localhost:3000 for local development.
 */
export function useSiteUrl(): string {
	const config = useRuntimeConfig();
	const url = config.public?.siteUrl;
	return url && url.length > 0 ? url : DEFAULT_SITE_URL;
}

/**
 * Apply complete SEO metadata via useHead.
 *
 * Generates:
 * - <title> and <meta name="description">
 * - OpenGraph tags (og:title, og:description, og:type, og:image, og:url, og:locale)
 * - Twitter Card tags (twitter:card, twitter:title, twitter:description,
 *   twitter:image, twitter:image:alt, twitter:site)
 * - <link rel="canonical">
 * - robots meta "noindex, follow" (when noindex is true)
 * - JSON-LD BlogPosting script (when article metadata is provided)
 *
 * All values fall back to siteConfig defaults when not provided.
 */
export function useSeo(options: SeoOptions): void {
	const siteUrl = useSiteUrl();
	const path = options.path || "/";
	const canonicalUrl = buildCanonicalUrl(path, siteUrl);
	const imageUrl = buildAbsoluteImageUrl(options.image || siteConfig.image, siteUrl);
	const description = options.description || siteConfig.description;
	const isArticle = !!options.article;
	const keywordList =
		options.tags && options.tags.length > 0
			? options.tags.join(", ")
			: "X-Blog, 技术博客, FastAPI, Nuxt";

	const meta: Array<{ name?: string; property?: string; content: string }> = [
		{ name: "description", content: description },
		{ name: "keywords", content: keywordList },
		// OpenGraph (use property for og:* per the OpenGraph protocol)
		{ property: "og:title", content: options.title },
		{ property: "og:description", content: description },
		{ property: "og:type", content: isArticle ? "article" : "website" },
		{ property: "og:image", content: imageUrl },
		{ property: "og:url", content: canonicalUrl },
		{ property: "og:locale", content: siteConfig.locale },
		// Twitter Card
		{ name: "twitter:card", content: "summary_large_image" },
		{ name: "twitter:title", content: options.title },
		{ name: "twitter:description", content: description },
		{ name: "twitter:image", content: imageUrl },
		{ name: "twitter:image:alt", content: options.title },
		{ name: "twitter:site", content: siteConfig.twitterHandle },
	];

	if (options.noindex) {
		meta.push({ name: "robots", content: "noindex, follow" });
	}

	const headInput: Record<string, unknown> = {
		title: options.title,
		meta,
		link: [buildCanonicalLink(canonicalUrl)],
	};

	if (options.article) {
		headInput.script = [
			{
				type: "application/ld+json",
				json: buildArticleJsonLd(
					{
						id: 0,
						title: options.title,
						slug: "",
						excerpt: description,
						created_at: options.article.datePublished,
						updated_at: options.article.dateModified,
						cover_image: options.image || null,
						category: options.article.section ? { id: 0, name: options.article.section } : null,
						tags: options.article.tags ? options.article.tags.map((name) => ({ id: 0, name })) : [],
					},
					{
						url: canonicalUrl,
						siteName: siteConfig.name,
						locale: siteConfig.locale,
					},
				),
			},
		];
	}

	useHead(headInput);
}

/**
 * Apply SEO metadata for a blog post.
 * Accepts a post object (matching the Post interface from useApi).
 * Sets title, description, og:image (cover), canonical URL,
 * and emits a BlogPosting JSON-LD script.
 */
export function usePostSeo(post: SeoPostData): void {
	const siteUrl = useSiteUrl();
	const path = `/posts/${post.slug}`;
	const tags = post.tags.map((t) => t.name);

	useSeo({
		title: post.title,
		description: post.excerpt || undefined,
		path,
		image: post.cover_image || undefined,
		tags,
		article: {
			datePublished: post.created_at,
			dateModified: post.updated_at,
			author: siteConfig.name,
			section: post.category?.name || "Blog",
			tags,
		},
	});
}
