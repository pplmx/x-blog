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
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
