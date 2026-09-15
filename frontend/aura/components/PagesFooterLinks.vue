<script setup lang="ts">
// Footer "Pages" links (round 347): the published static pages are only
// discoverable by URL unless the site links them somewhere, so the footer
// surfaces them. Client-side only (server: false) — the list must not add an
// SSR-blocking round trip to every page render.
import { usePages } from "~~/api/public/pages";

const { t } = useLang();
const { data: pages } = await usePages();

// No published pages is a normal state (site owner hasn't created any), not
// an error — render nothing. A genuine failure also renders nothing rather
// than a dead link block; the pages remain reachable by URL.
</script>

<template>
  <nav v-if="pages?.length" class="mb-6" :aria-label="t('pages.footerLabel')">
    <NuxtLink
      v-for="p in pages"
      :key="p.slug"
      :to="`/pages/${p.slug}`"
      class="inline-flex items-center gap-1 text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors mr-4"
    >
      <Icon icon="lucide:file-text" class="w-3.5 h-3.5" />
      {{ p.title }}
    </NuxtLink>
  </nav>
</template>
