// https://nuxt.com/docs/api/configuration/nuxt-config

import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildSiteJsonLd } from "./composables/useSeo";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

// Site-wide constants used in both the global head and runtime config.
const siteUrl = process.env.NUXT_SITE_URL || "http://localhost:3000";
const siteName = "X-Blog";
const siteDescription =
	"X-Blog 是一个基于 FastAPI + Nuxt 的现代化技术博客系统，支持 Markdown、Mermaid 图表、KaTeX 数学公式、代码高亮、文章分类、标签管理、阅读计数、点赞评论等功能。";

export default defineNuxtConfig({
	compatibilityDate: "2025-07-15",
	devtools: { enabled: true },
	modules: [],
	nitro: {
		preset: "nodejs",
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
				{ property: "og:image", content: `${siteUrl}/logo.png` },
				{ property: "og:url", content: siteUrl },
				{ property: "og:locale", content: "zh_CN" },
				{ name: "twitter:card", content: "summary_large_image" },
				{ name: "twitter:title", content: "X-Blog — 一个现代化的技术博客系统" },
				{
					name: "twitter:description",
					content: "X-Blog 是一个基于 FastAPI + Nuxt 的现代化技术博客系统。",
				},
				{ name: "twitter:image", content: `${siteUrl}/logo.png` },
				{
					name: "twitter:image:alt",
					content: "X-Blog — 一个现代化的技术博客系统",
				},
				{ name: "twitter:site", content: "@x_blog" },
			],
			script: [
				{
					type: "application/ld+json",
					json: buildSiteJsonLd({
						url: siteUrl,
						siteName: siteName,
						description: siteDescription,
					}),
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
			},
		},
	},
	postcss: {
		plugins: {
			"@tailwindcss/postcss": {},
			autoprefixer: {},
		},
	},
});
