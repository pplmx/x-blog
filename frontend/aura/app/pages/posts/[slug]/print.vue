<script setup lang="ts">
import { computed } from "vue";
import { usePost } from "~~/api/public/posts";
import { parseApiDate } from "~~/composables/apiDate";
import { readingMinutes } from "~~/composables/useReadingTime";

// Print / PDF view of a post (DEC-112, TASK-168).
// Frontend-only: a clean typographic rendering of a single article that a
// reader can save via the browser's print-to-PDF, without the site chrome.
const route = useRoute();
const { t, locale } = useLang();
// Reactive getter so SPA navigation between slugs refetches (same as post page).
const { data: post, pending, error } = await usePost(() => route.params.slug as string);

const readingTime = computed(() => readingMinutes(post.value?.content));

// The print route is a duplicate surface for archiving only — keep search
// engines from indexing it as a separate page (canonical lives on the article).
useHead({
	title: post.value ? `${post.value.title} — ${t("post.printPdf")}` : t("post.notFoundTitle"),
	meta: [{ name: "robots", content: "noindex, nofollow" }],
});

function printPage() {
	window.print();
}
</script>

<template>
  <div class="print-shell">
    <div class="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <!-- Screen-only toolbar (hidden in print) -->
      <div
        class="no-print flex items-center justify-between gap-3 mb-8 pb-5 border-b border-gray-100 dark:border-gray-800"
      >
        <NuxtLink
          :to="`/posts/${route.params.slug}`"
          class="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
        >
          <Icon icon="lucide:arrow-left" class="w-4 h-4" />
          {{ t('post.backToArticle') }}
        </NuxtLink>
        <button
          type="button"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          @click="printPage"
        >
          <Icon icon="lucide:printer" class="w-4 h-4" />
          {{ t('post.printPdf') }}
        </button>
      </div>

      <!-- Loading skeleton -->
      <div v-if="pending" class="space-y-6">
        <div class="h-8 bg-gray-200 dark:bg-gray-800 rounded-lg w-3/4 animate-pulse" />
        <div class="h-64 bg-gray-200 dark:bg-gray-800 rounded-2xl animate-pulse" />
        <div class="space-y-3">
          <div class="h-4 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
          <div class="h-4 bg-gray-200 dark:bg-gray-800 rounded w-5/6 animate-pulse" />
        </div>
      </div>

      <div v-else-if="error || !post" class="text-center py-20 text-gray-500">
        <Icon icon="lucide:file-question" class="w-12 h-12 mx-auto mb-4 text-gray-300" />
        <p>{{ t('post.notFound') }}</p>
      </div>

      <!-- Print-ready article -->
      <article v-else class="print-article">
        <header class="mb-8">
          <h1 class="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-100 leading-tight mb-4 text-balance">
            {{ post.title }}
          </h1>
          <div class="flex flex-wrap items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
            <span class="inline-flex items-center gap-1.5">
              <Icon icon="lucide:calendar" class="w-3.5 h-3.5" />
              {{ parseApiDate(post.created_at)?.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", { year: 'numeric', month: 'long', day: 'numeric' }) ?? "" }}
            </span>
            <span class="inline-flex items-center gap-1.5">
              <Icon icon="lucide:clock" class="w-3.5 h-3.5" />
              {{ t('post.readingTime', { count: readingTime }) }}
            </span>
          </div>
          <p v-if="post.excerpt" class="mt-5 text-base text-gray-600 dark:text-gray-400 leading-relaxed">
            {{ post.excerpt }}
          </p>
        </header>

        <div class="prose-config print-content">
          <MarkdownContent :content="post.content" />
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
/* Print-only adjustments: full-width reading measure and page margins. The
   site chrome (header/footer/nav and the .no-print toolbar) is hidden by the
   global @media print rules in assets/css/main.css. */
@media print {
	.print-shell {
		width: 100%;
	}
	.print-article {
		-webkit-print-color-adjust: exact;
		print-color-adjust: exact;
	}
	.print-content :deep(pre),
	.print-content :deep(code) {
		white-space: pre-wrap;
		word-break: break-word;
	}
}
</style>
