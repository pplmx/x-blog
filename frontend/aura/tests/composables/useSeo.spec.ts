/**
 * SEO composable tests
 *
 * Tests the pure builder functions (buildCanonicalUrl, buildAbsoluteImageUrl,
 * buildCanonicalLink, buildArticleJsonLd, buildSiteJsonLd) and the
 * Nuxt-dependent composables (useSiteUrl, useSeo).
 *
 * The pure functions are tested without any stubs.
 * The composables use vi.stubGlobal to mock useRuntimeConfig and useHead.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSiteJsonLd } from "../../composables/seo-jsonld.ts";
import {
	buildAbsoluteImageUrl,
	buildArticleJsonLd,
	buildCanonicalLink,
	buildCanonicalUrl,
	buildOgImageUrl,
	DEFAULT_SITE_URL,
	siteConfig,
	usePostSeo,
	useSeo,
	useSiteUrl,
} from "../../composables/useSeo.ts";

// ─── Mock post data (matches SeoPostData interface) ──────────────────

const mockPost = {
	id: 1,
	title: "Test Article Post",
	slug: "test-article-post",
	excerpt: "This is a test excerpt for the article.",
	created_at: "2024-01-15T10:30:00Z",
	updated_at: "2024-01-15T10:30:00Z",
	cover_image: "https://example.com/cover.jpg",
	category: { id: 1, name: "Tech" },
	tags: [
		{ id: 1, name: "React" },
		{ id: 2, name: "TypeScript" },
	],
};

const mockPostNoCover = {
	id: 2,
	title: "Post Without Cover",
	slug: "post-without-cover",
	excerpt: null,
	created_at: "2024-02-20T14:00:00Z",
	updated_at: "2024-02-21T09:00:00Z",
	cover_image: null,
	category: null,
	tags: [],
};

// ─── Pure builders ───────────────────────────────────────────────────

describe("buildCanonicalUrl", () => {
	it("builds a canonical URL with the site URL and path", () => {
		expect(buildCanonicalUrl("/posts/my-post", "https://example.com")).toBe(
			"https://example.com/posts/my-post",
		);
	});

	it("adds a leading slash if the path lacks one", () => {
		expect(buildCanonicalUrl("posts/my-post", "https://example.com")).toBe(
			"https://example.com/posts/my-post",
		);
	});

	it("strips trailing slash (except for root path)", () => {
		expect(buildCanonicalUrl("/posts/my-post/", "https://example.com")).toBe(
			"https://example.com/posts/my-post",
		);
		expect(buildCanonicalUrl("/", "https://example.com")).toBe("https://example.com/");
	});

	it("uses DEFAULT_SITE_URL when siteUrl is not provided", () => {
		expect(buildCanonicalUrl("/about")).toBe(`${DEFAULT_SITE_URL}/about`);
	});

	it("uses DEFAULT_SITE_URL when siteUrl is empty", () => {
		expect(buildCanonicalUrl("/about", "")).toBe(`${DEFAULT_SITE_URL}/about`);
	});
});

describe("buildAbsoluteImageUrl", () => {
	it("returns absolute URLs unchanged", () => {
		expect(buildAbsoluteImageUrl("https://example.com/cover.jpg", "https://site.com")).toBe(
			"https://example.com/cover.jpg",
		);
	});

	it("resolves relative URLs against the site URL", () => {
		expect(buildAbsoluteImageUrl("/logo.png", "https://site.com")).toBe(
			"https://site.com/logo.png",
		);
	});

	it("adds a leading slash to bare relative paths", () => {
		expect(buildAbsoluteImageUrl("logo.png", "https://site.com")).toBe("https://site.com/logo.png");
	});

	it("returns empty string for empty input", () => {
		expect(buildAbsoluteImageUrl("", "https://site.com")).toBe("");
	});

	it("uses DEFAULT_SITE_URL when siteUrl is not provided", () => {
		expect(buildAbsoluteImageUrl("/logo.png")).toBe(`${DEFAULT_SITE_URL}/logo.png`);
	});
});

describe("buildCanonicalLink", () => {
	it("returns a link object with rel and href", () => {
		expect(buildCanonicalLink("https://example.com/posts/my-post")).toEqual({
			rel: "canonical",
			href: "https://example.com/posts/my-post",
		});
	});
});

describe("buildOgImageUrl", () => {
	it("builds an OG image URL with the title encoded", () => {
		expect(buildOgImageUrl("Test Post", "https://example.com")).toBe(
			"https://example.com/api/og?title=Test%20Post",
		);
	});

	it("encodes Chinese characters properly", () => {
		expect(buildOgImageUrl("测试文章", "https://example.com")).toBe(
			"https://example.com/api/og?title=%E6%B5%8B%E8%AF%95%E6%96%87%E7%AB%A0",
		);
	});

	it("uses DEFAULT_SITE_URL when siteUrl is not provided", () => {
		expect(buildOgImageUrl("Test Post")).toBe(`${DEFAULT_SITE_URL}/api/og?title=Test%20Post`);
	});
});

describe("buildArticleJsonLd", () => {
	const options = {
		url: "https://example.com/posts/test-article-post",
		siteName: "X-Blog",
		locale: "zh_CN",
	};

	it("produces BlogPosting JSON-LD with all required fields", () => {
		const jsonLd = buildArticleJsonLd(mockPost, options);

		expect(jsonLd["@context"]).toBe("https://schema.org");
		expect(jsonLd["@type"]).toBe("BlogPosting");
		expect(jsonLd.headline).toBe("Test Article Post");
		expect(jsonLd.description).toBe("This is a test excerpt for the article.");
		expect(jsonLd.image).toBe("https://example.com/cover.jpg");
		expect(jsonLd.datePublished).toBe("2024-01-15T10:30:00Z");
		expect(jsonLd.dateModified).toBe("2024-01-15T10:30:00Z");
	});

	it("includes author and publisher with Person/Organization type", () => {
		const jsonLd = buildArticleJsonLd(mockPost, options);

		expect(jsonLd.author).toEqual({
			"@type": "Person",
			name: "X-Blog",
		});
		expect(jsonLd.publisher).toEqual({
			"@type": "Organization",
			name: "X-Blog",
			logo: {
				"@type": "ImageObject",
				url: buildAbsoluteImageUrl(siteConfig.image),
			},
		});
	});

	it("absolutizes relative cover images in JSON-LD", () => {
		const relativePost = { ...mockPost, cover_image: "/static/uploads/2024/07/cover.jpg" };
		const jsonLd = buildArticleJsonLd(relativePost, options);

		expect(jsonLd.image).toBe("http://localhost:3000/static/uploads/2024/07/cover.jpg");
	});

	it("includes mainEntityOfPage with the provided URL", () => {
		const jsonLd = buildArticleJsonLd(mockPost, options);

		expect(jsonLd.mainEntityOfPage).toEqual({
			"@type": "WebPage",
			"@id": "https://example.com/posts/test-article-post",
		});
	});

	it("includes articleSection from the post category", () => {
		const jsonLd = buildArticleJsonLd(mockPost, options);
		expect(jsonLd.articleSection).toBe("Tech");
	});

	it("uses 'Blog' as articleSection when category is null", () => {
		const jsonLd = buildArticleJsonLd(mockPostNoCover, options);
		expect(jsonLd.articleSection).toBe("Blog");
	});

	it("joins tag names as keywords", () => {
		const jsonLd = buildArticleJsonLd(mockPost, options);
		expect(jsonLd.keywords).toBe("React, TypeScript");
	});

	it("handles null excerpt gracefully", () => {
		const jsonLd = buildArticleJsonLd(mockPostNoCover, options);
		expect(jsonLd.description).toBe("");
	});

	it("handles null cover_image (image is undefined)", () => {
		const jsonLd = buildArticleJsonLd(mockPostNoCover, options);
		expect(jsonLd.image).toBeUndefined();
	});

	it("handles empty tags array", () => {
		const jsonLd = buildArticleJsonLd(mockPostNoCover, options);
		expect(jsonLd.keywords).toBe("");
	});
});

describe("buildSiteJsonLd", () => {
	it("produces WebSite JSON-LD with name, description, and url", () => {
		const jsonLd = buildSiteJsonLd({
			url: "https://example.com",
			siteName: "X-Blog",
			description: "A modern blog system.",
		});

		expect(jsonLd["@context"]).toBe("https://schema.org");
		expect(jsonLd["@type"]).toBe("WebSite");
		expect(jsonLd.name).toBe("X-Blog");
		expect(jsonLd.description).toBe("A modern blog system.");
		expect(jsonLd.url).toBe("https://example.com");
	});

	it("includes publisher Organization", () => {
		const jsonLd = buildSiteJsonLd({
			url: "https://example.com",
			siteName: "X-Blog",
			description: "A blog.",
		});

		expect(jsonLd.publisher).toEqual({
			"@type": "Organization",
			name: "X-Blog",
		});
	});
});

describe("siteConfig", () => {
	it("exposes the site name", () => {
		expect(siteConfig.name).toBe("X-Blog");
	});

	it("exposes the site title", () => {
		expect(siteConfig.title).toBe("X-Blog — 一个现代化的技术博客系统");
	});

	it("exposes the locale as zh_CN", () => {
		expect(siteConfig.locale).toBe("zh_CN");
	});

	it("exposes the twitter handle", () => {
		expect(siteConfig.twitterHandle).toBe("@x_blog");
	});

	it("exposes a default OG image endpoint", () => {
		expect(siteConfig.image).toBe("/api/og?title=X-Blog");
	});
});

// ─── Composables (use Nuxt) ──────────────────────────────────────────

describe("useSiteUrl composable", () => {
	beforeEach(() => {
		vi.stubGlobal("useRuntimeConfig", () => ({
			public: {
				siteUrl: "https://my-blog.com",
			},
		}));
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns the siteUrl from runtime config", () => {
		expect(useSiteUrl()).toBe("https://my-blog.com");
	});

	it("falls back to DEFAULT_SITE_URL when siteUrl is missing", () => {
		vi.stubGlobal("useRuntimeConfig", () => ({
			public: {},
		}));
		expect(useSiteUrl()).toBe(DEFAULT_SITE_URL);
	});

	it("falls back to DEFAULT_SITE_URL when siteUrl is empty", () => {
		vi.stubGlobal("useRuntimeConfig", () => ({
			public: { siteUrl: "" },
		}));
		expect(useSiteUrl()).toBe(DEFAULT_SITE_URL);
	});
});

describe("useSeo composable", () => {
	let useHeadSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		useHeadSpy = vi.fn();
		vi.stubGlobal("useHead", useHeadSpy);

		vi.stubGlobal("useRuntimeConfig", () => ({
			public: {
				siteUrl: "https://my-blog.com",
			},
		}));
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("calls useHead with title and meta array", () => {
		useSeo({
			title: "My Page",
			description: "A description.",
			path: "/my-page",
		});

		expect(useHeadSpy).toHaveBeenCalledTimes(1);
		const callArg = useHeadSpy.mock.calls[0][0];
		expect(callArg.title).toBe("My Page");
		expect(Array.isArray(callArg.meta)).toBe(true);
	});

	it("includes a description meta tag", () => {
		useSeo({
			title: "My Page",
			description: "A description.",
			path: "/my-page",
		});

		const callArg = useHeadSpy.mock.calls[0][0];
		const desc = callArg.meta.find((m: { name?: string }) => m.name === "description");
		expect(desc?.content).toBe("A description.");
	});

	it("falls back to siteConfig description when not provided", () => {
		useSeo({
			title: "My Page",
			path: "/my-page",
		});

		const callArg = useHeadSpy.mock.calls[0][0];
		const desc = callArg.meta.find((m: { name?: string }) => m.name === "description");
		expect(desc?.content).toBe(siteConfig.description);
	});

	it("includes OpenGraph tags with property attribute", () => {
		useSeo({
			title: "My Page",
			description: "A description.",
			path: "/my-page",
		});

		const callArg = useHeadSpy.mock.calls[0][0];
		const ogTitle = callArg.meta.find((m: { property?: string }) => m.property === "og:title");
		expect(ogTitle?.content).toBe("My Page");

		const ogType = callArg.meta.find((m: { property?: string }) => m.property === "og:type");
		expect(ogType?.content).toBe("website");

		const ogImage = callArg.meta.find((m: { property?: string }) => m.property === "og:image");
		expect(ogImage?.content).toBe("https://my-blog.com/api/og?title=X-Blog");

		const ogUrl = callArg.meta.find((m: { property?: string }) => m.property === "og:url");
		expect(ogUrl?.content).toBe("https://my-blog.com/my-page");

		const ogLocale = callArg.meta.find((m: { property?: string }) => m.property === "og:locale");
		expect(ogLocale?.content).toBe("zh_CN");
	});

	it("includes Twitter Card tags", () => {
		useSeo({
			title: "My Page",
			description: "A description.",
			path: "/my-page",
		});

		const callArg = useHeadSpy.mock.calls[0][0];
		const twitterCard = callArg.meta.find((m: { name?: string }) => m.name === "twitter:card");
		expect(twitterCard?.content).toBe("summary_large_image");

		const twitterTitle = callArg.meta.find((m: { name?: string }) => m.name === "twitter:title");
		expect(twitterTitle?.content).toBe("My Page");

		const twitterImage = callArg.meta.find((m: { name?: string }) => m.name === "twitter:image");
		expect(twitterImage?.content).toBe("https://my-blog.com/api/og?title=X-Blog");

		const twitterAlt = callArg.meta.find((m: { name?: string }) => m.name === "twitter:image:alt");
		expect(twitterAlt?.content).toBe("My Page");

		const twitterSite = callArg.meta.find((m: { name?: string }) => m.name === "twitter:site");
		expect(twitterSite?.content).toBe(siteConfig.twitterHandle);
	});

	it("includes a canonical link tag", () => {
		useSeo({
			title: "My Page",
			description: "A description.",
			path: "/my-page",
		});

		const callArg = useHeadSpy.mock.calls[0][0];
		const canonical = callArg.link.find((l: { rel?: string }) => l.rel === "canonical");
		expect(canonical?.href).toBe("https://my-blog.com/my-page");
	});

	it("includes keywords meta tag with provided tags", () => {
		useSeo({
			title: "My Page",
			description: "A description.",
			path: "/my-page",
			tags: ["React", "Vue"],
		});

		const callArg = useHeadSpy.mock.calls[0][0];
		const keywords = callArg.meta.find((m: { name?: string }) => m.name === "keywords");
		expect(keywords?.content).toBe("React, Vue");
	});

	it("includes default keywords when no tags provided", () => {
		useSeo({
			title: "My Page",
			description: "A description.",
			path: "/my-page",
		});

		const callArg = useHeadSpy.mock.calls[0][0];
		const keywords = callArg.meta.find((m: { name?: string }) => m.name === "keywords");
		expect(keywords?.content).toBe("X-Blog, 技术博客, FastAPI, Nuxt");
	});

	it("includes noindex robots meta when noindex is true", () => {
		useSeo({
			title: "Search",
			description: "Search results.",
			path: "/search",
			noindex: true,
		});

		const callArg = useHeadSpy.mock.calls[0][0];
		const robots = callArg.meta.find((m: { name?: string }) => m.name === "robots");
		expect(robots?.content).toBe("noindex, follow");
	});

	it("does NOT include robots meta when noindex is false", () => {
		useSeo({
			title: "My Page",
			description: "A description.",
			path: "/my-page",
		});

		const callArg = useHeadSpy.mock.calls[0][0];
		const robots = callArg.meta.find((m: { name?: string }) => m.name === "robots");
		expect(robots).toBeUndefined();
	});

	it("accepts a getter and re-evaluates the title reactively (RIL TASK-080)", () => {
		const title = ref("Tag One");
		useSeo(() => ({
			title: title.value ? `Tag ${title.value}` : "All Tags",
			description: "Tags page",
			path: "/tags",
		}));

		// Getter path passes a compat/computed to useHead; its .value resolves
		// the current reactive state.
		const headRef = useHeadSpy.mock.calls[0][0] as { value: { title: string } };
		expect(headRef.value.title).toBe("Tag Tag One");

		// Mutate the reactive source → the resolved title reflects it.
		title.value = "Tag Two";
		expect(headRef.value.title).toBe("Tag Tag Two");
	});

	it("uses og:type 'article' when article metadata is provided", () => {
		useSeo({
			title: "My Post",
			description: "A post description.",
			path: "/posts/my-post",
			article: {
				datePublished: "2024-01-01T00:00:00Z",
				dateModified: "2024-01-02T00:00:00Z",
				author: "X-Blog",
				section: "Tech",
				tags: ["React"],
			},
		});

		const callArg = useHeadSpy.mock.calls[0][0];
		const ogType = callArg.meta.find((m: { property?: string }) => m.property === "og:type");
		expect(ogType?.content).toBe("article");
	});

	it("emits BlogPosting JSON-LD script when article metadata is provided", () => {
		useSeo({
			title: "My Post",
			description: "A post description.",
			path: "/posts/my-post",
			article: {
				datePublished: "2024-01-01T00:00:00Z",
				dateModified: "2024-01-02T00:00:00Z",
				author: "X-Blog",
				section: "Tech",
				tags: ["React", "TypeScript"],
			},
		});

		const callArg = useHeadSpy.mock.calls[0][0];
		const ldScripts = callArg.script.filter(
			(s: { type: string }) => s.type === "application/ld+json",
		);
		expect(ldScripts.length).toBe(1);

		const jsonLd = JSON.parse(ldScripts[0].textContent);
		expect(jsonLd["@context"]).toBe("https://schema.org");
		expect(jsonLd["@type"]).toBe("BlogPosting");
		expect(jsonLd.headline).toBe("My Post");
		expect(jsonLd.datePublished).toBe("2024-01-01T00:00:00Z");
		expect(jsonLd.dateModified).toBe("2024-01-02T00:00:00Z");
		expect(jsonLd.author.name).toBe("X-Blog");
		expect(jsonLd.articleSection).toBe("Tech");
		expect(jsonLd.keywords).toBe("React, TypeScript");
		expect(jsonLd.mainEntityOfPage["@id"]).toBe("https://my-blog.com/posts/my-post");
	});

	it("does NOT emit JSON-LD when no article metadata is provided", () => {
		useSeo({
			title: "My Page",
			description: "A description.",
			path: "/my-page",
		});

		const callArg = useHeadSpy.mock.calls[0][0];
		expect(callArg.script).toBeUndefined();
	});

	it("resolves custom image URL to absolute", () => {
		useSeo({
			title: "My Post",
			description: "A description.",
			path: "/posts/my-post",
			image: "https://cdn.example.com/cover.jpg",
		});

		const callArg = useHeadSpy.mock.calls[0][0];
		const ogImage = callArg.meta.find((m: { property?: string }) => m.property === "og:image");
		expect(ogImage?.content).toBe("https://cdn.example.com/cover.jpg");
	});
});

describe("usePostSeo composable", () => {
	let useHeadSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		useHeadSpy = vi.fn();
		vi.stubGlobal("useHead", useHeadSpy);

		vi.stubGlobal("useRuntimeConfig", () => ({
			public: {
				siteUrl: "https://my-blog.com",
			},
		}));
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("sets title and description from the post", () => {
		usePostSeo(mockPost);

		const callArg = useHeadSpy.mock.calls[0][0];
		expect(callArg.title).toBe("Test Article Post");

		const desc = callArg.meta.find((m: { name?: string }) => m.name === "description");
		expect(desc?.content).toBe("This is a test excerpt for the article.");
	});

	it("sets canonical URL from post slug", () => {
		usePostSeo(mockPost);

		const callArg = useHeadSpy.mock.calls[0][0];
		const canonical = callArg.link.find((l: { rel?: string }) => l.rel === "canonical");
		expect(canonical?.href).toBe("https://my-blog.com/posts/test-article-post");
	});

	it("sets og:image to the post cover_image (absolute URL)", () => {
		usePostSeo(mockPost);

		const callArg = useHeadSpy.mock.calls[0][0];
		const ogImage = callArg.meta.find((m: { property?: string }) => m.property === "og:image");
		expect(ogImage?.content).toBe("https://example.com/cover.jpg");
	});

	it("falls back to siteConfig image when cover_image is null", () => {
		usePostSeo(mockPostNoCover);

		const callArg = useHeadSpy.mock.calls[0][0];
		const ogImage = callArg.meta.find((m: { property?: string }) => m.property === "og:image");
		expect(ogImage?.content).toBe("https://my-blog.com/api/cover?title=Post%20Without%20Cover");
	});

	it("falls back to siteConfig description when excerpt is null", () => {
		usePostSeo(mockPostNoCover);

		const callArg = useHeadSpy.mock.calls[0][0];
		const desc = callArg.meta.find((m: { name?: string }) => m.name === "description");
		expect(desc?.content).toBe(siteConfig.description);
	});

	it("emits BlogPosting JSON-LD with post data", () => {
		usePostSeo(mockPost);

		const callArg = useHeadSpy.mock.calls[0][0];
		const ldScripts = callArg.script.filter(
			(s: { type: string }) => s.type === "application/ld+json",
		);
		expect(ldScripts.length).toBe(1);

		const jsonLd = JSON.parse(ldScripts[0].textContent);
		expect(jsonLd["@type"]).toBe("BlogPosting");
		expect(jsonLd.headline).toBe("Test Article Post");
		expect(jsonLd.datePublished).toBe("2024-01-15T10:30:00Z");
		expect(jsonLd.dateModified).toBe("2024-01-15T10:30:00Z");
		expect(jsonLd.author.name).toBe("X-Blog");
		expect(jsonLd.articleSection).toBe("Tech");
		expect(jsonLd.keywords).toBe("React, TypeScript");
		expect(jsonLd.image).toBe("https://example.com/cover.jpg");
		expect(jsonLd.mainEntityOfPage["@id"]).toBe("https://my-blog.com/posts/test-article-post");
	});

	it("sets og:type to 'article'", () => {
		usePostSeo(mockPost);

		const callArg = useHeadSpy.mock.calls[0][0];
		const ogType = callArg.meta.find((m: { property?: string }) => m.property === "og:type");
		expect(ogType?.content).toBe("article");
	});

	it("includes tag names as keywords", () => {
		usePostSeo(mockPost);

		const callArg = useHeadSpy.mock.calls[0][0];
		const keywords = callArg.meta.find((m: { name?: string }) => m.name === "keywords");
		expect(keywords?.content).toBe("React, TypeScript");
	});

	it("handles post with null category and empty tags", () => {
		usePostSeo(mockPostNoCover);

		const callArg = useHeadSpy.mock.calls[0][0];
		const ldScripts = callArg.script.filter(
			(s: { type: string }) => s.type === "application/ld+json",
		);
		const jsonLd = JSON.parse(ldScripts[0].textContent);
		expect(jsonLd.articleSection).toBe("Blog");
		expect(jsonLd.keywords).toBe("");
	});
});
