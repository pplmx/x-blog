<script setup lang="ts">
const { locale } = useLang();

// Keep <html lang> in sync with the active locale (reactivity via unhead fn).
useHead({ htmlAttrs: { lang: () => locale.value } });

// Feed auto-discovery: let browsers and feed readers detect the RSS/Atom
// feeds (proxied by the Nuxt server to /rss/*.xml on the backend).
useHead({
	link: [
		{ rel: "alternate", type: "application/rss+xml", title: "RSS", href: "/rss/feed.xml" },
		{ rel: "alternate", type: "application/atom+xml", title: "Atom", href: "/rss/atom.xml" },
	],
});

// Site-default URL-dependent head tags. The nuxt.config global head is baked
// at image BUILD time — when NUXT_SITE_URL is unset there (docker-compose only
// sets it at container runtime) the fallback "http://localhost:3000" got baked
// into every deployed page's og:url / og:image / WebSite JSON-LD, so crawlers
// resolved share cards to the dev origin. These tags therefore resolve from
// the runtime site URL (useSiteUrl → runtimeConfig.public.siteUrl, TASK-557).
// Per-page useSeo() entries take precedence for the same keys (component head
// wins over the app root), so specific pages still override the site default.
//
// The site URL is resolved EAGERLY here, not inside the useHead argument:
// unhead resolves head inputs lazily during renderSSRHead, OUTSIDE the Nuxt
// instance context — calling useRuntimeConfig in the getter throws NUXT_E1001
// (same constraint documented at useSeo.ts's useSiteUrl usage). The URL is a
// per-deployment constant, so an eager capture per request is correct.
const siteUrl = useSiteUrl();
useHead({
	meta: [
		{ property: "og:url", content: siteUrl },
		{ property: "og:image", content: buildAbsoluteImageUrl(siteConfig.image, siteUrl) },
		{ name: "twitter:image", content: buildAbsoluteImageUrl(siteConfig.image, siteUrl) },
	],
	script: [
		{
			type: "application/ld+json",
			textContent: JSON.stringify(
				buildSiteJsonLd({
					url: siteUrl,
					siteName: siteConfig.name,
					description: siteConfig.description,
				}),
			),
		},
	],
});
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
