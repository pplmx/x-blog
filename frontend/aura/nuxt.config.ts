// https://nuxt.com/docs/api/configuration/nuxt-config

import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildSiteJsonLd } from "./composables/seo-jsonld";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

// Site-wide constants used in both the global head and runtime config.
// Default must match useSeo.DEFAULT_SITE_URL and runtimeConfig.public.siteUrl
// below — the old "http://localhost:3001" was an orphaned port (survived only
// here and the backend dev ALLOWED_ORIGINS) that got baked into the global
// og:url / WebSite JSON-LD url whenever NUXT_SITE_URL was unset at build time
// (docker-compose sets it at runtime only). NUXT_SITE_URL still overrides.
const siteUrl = process.env.NUXT_SITE_URL || "http://localhost:3000";
const siteName = "X-Blog";
const siteDescription =
	"X-Blog 是一个基于 FastAPI + Nuxt 的现代化技术博客系统，支持 Markdown、Mermaid 图表、KaTeX 数学公式、代码高亮、文章分类、标签管理、阅读计数、点赞评论等功能。";

// Dynamic OG image URL for global default (generates PNG with Chinese font support)
const ogImageUrl = `${siteUrl}/api/og?title=${encodeURIComponent(siteName)}&type=website`;

export default defineNuxtConfig({
	compatibilityDate: "2025-07-15",
	devtools: { enabled: true },
	modules: [],
	nitro: {
		preset: "node-server",
	},
	css: ["~~/assets/css/main.css"],
	app: {
		head: {
			charset: "utf-8",
			viewport: "width=device-width, initial-scale=1",
			title: "X-Blog — 一个现代化的技术博客系统",
			meta: [
				{
					name: "description",
					content: siteDescription,
				},
				{
					name: "keywords",
					content: "X-Blog, 技术博客, FastAPI, Nuxt, Markdown, Mermaid, KaTeX",
				},
				{ property: "og:title", content: "X-Blog — 一个现代化的技术博客系统" },
				{
					property: "og:description",
					content: "X-Blog 是一个基于 FastAPI + Nuxt 的现代化技术博客系统。",
				},
				{ property: "og:type", content: "website" },
				{ property: "og:image", content: ogImageUrl },
				{ property: "og:url", content: siteUrl },
				{ property: "og:locale", content: "zh_CN" },
				{ name: "twitter:card", content: "summary_large_image" },
				{ name: "twitter:title", content: "X-Blog — 一个现代化的技术博客系统" },
				{
					name: "twitter:description",
					content: "X-Blog 是一个基于 FastAPI + Nuxt 的现代化技术博客系统。",
				},
				{ name: "twitter:image", content: ogImageUrl },
				{
					name: "twitter:image:alt",
					content: "X-Blog — 一个现代化的技术博客系统",
				},
				{ name: "twitter:site", content: "@x_blog" },
			],
			script: [
				{
					type: "application/ld+json",
					textContent: JSON.stringify(
						buildSiteJsonLd({
							url: siteUrl,
							siteName: siteName,
							description: siteDescription,
						}),
					),
				},
			],
		},
	},
	runtimeConfig: {
		public: {
			apiUrl: process.env.NUXT_API_URL || "",
			siteUrl: process.env.NUXT_SITE_URL || "http://localhost:3000",
		},
	},
	// Nuxt 4's srcDir is app/, so the default composables scan looks in
	// app/composables and misses the project composables in rootDir/composables
	// (useUpload, useI18n, useBookmarks, ...). Pages that relied on
	// auto-import (e.g. the post editor's useUpload) crashed at runtime with
	// "useUpload is not defined" in the production build.
	imports: {
		dirs: [resolve(rootDir, "composables")],
	},
	components: [
		{
			prefix: "",
			path: resolve(rootDir, "components"),
			pathPrefix: false,
		},
	],
	vite: {
		resolve: {
			alias: {
				"~~": resolve(rootDir),
				// tailwindcss exports its CSS entry only under the "style"
				// condition; Vite's SSR css import resolution doesn't apply it,
				// so `@import "tailwindcss"` resolved to a nonexistent
				// relative path and the production build failed (ENOENT).
				tailwindcss: resolve(rootDir, "node_modules/tailwindcss/index.css"),
			},
		},
	},
	postcss: {
		plugins: {
			// Explicit postcss-import with node_modules resolution: the SSR
			// build's css pipeline otherwise tries to open bare specifiers
			// like "tailwindcss" as relative files and fails the build
			// (ENOENT .../tailwindcss).
			"postcss-import": {
				resolve(id: string, basedir: string) {
					if (id.startsWith(".") || id.startsWith("/")) {
						return resolve(basedir, id);
					}
					return require.resolve(id, { paths: [basedir] });
				},
			},
			"@tailwindcss/postcss": {},
			autoprefixer: {},
		},
	},
});
