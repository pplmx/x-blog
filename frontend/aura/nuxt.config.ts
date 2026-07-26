// https://nuxt.com/docs/api/configuration/nuxt-config
import process from "node:process";
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
					content:
						"X-Blog 是一个基于 FastAPI + Nuxt 的现代化技术博客系统，支持 Markdown、Mermaid 图表、KaTeX 数学公式、代码高亮、文章分类、标签管理、阅读计数、点赞评论等功能。",
				},
				{
					name: "keywords",
					content: "X-Blog, 技术博客, FastAPI, Nuxt, Markdown, Mermaid, KaTeX",
				},
				{ name: "og:title", content: "X-Blog — 一个现代化的技术博客系统" },
				{
					name: "og:description",
					content: "X-Blog 是一个基于 FastAPI + Nuxt 的现代化技术博客系统。",
				},
				{ name: "og:type", content: "website" },
				{ name: "og:locale", content: "zh_CN" },
				{ name: "twitter:card", content: "summary_large_image" },
				{ name: "twitter:title", content: "X-Blog — 一个现代化的技术博客系统" },
				{
					name: "twitter:description",
					content: "X-Blog 是一个基于 FastAPI + Nuxt 的现代化技术博客系统。",
				},
			],
		},
	},
	runtimeConfig: {
		public: {
			apiUrl: process.env.NUXT_API_URL || "http://localhost:18888",
		},
	},
	components: [
		{
			prefix: "",
			path: "~/components",
			pathPrefix: false,
		},
	],
	postcss: {
		plugins: {
			"@tailwindcss/postcss": {},
			autoprefixer: {},
		},
	},
});
