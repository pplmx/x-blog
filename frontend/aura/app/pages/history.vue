<script setup lang="ts">
/**
 * Reader reading-history page (DEC-114, TASK-169).
 *
 * Lists the reader's recently-viewed posts (from the client-side
 * useRecentlyViewed trail, newest-first) with continue-reading links, viewed
 * timestamps, a single clear-history action, and an empty state. Frontend-only
 * — no backend/schema dependency; the trail lives in localStorage.
 */
import { ref } from "vue";
import { type RecentlyViewedPost, useRecentlyViewed } from "~~/composables/useRecentlyViewed";
import { useSeo } from "~~/composables/useSeo";

const { t, locale } = useLang();
const { recent, clear } = useRecentlyViewed();

useSeo({
	title: t("history.seoTitle"),
	description: t("history.seoDesc"),
	path: "/history",
});

// Single-action clear with an inline confirmation (destructive, no undo).
const confirmClear = ref(false);

function clearHistory() {
	clear();
	confirmClear.value = false;
}

// Absolute viewed date, localized. Legacy entries without a timestamp fall
// back to a "recently viewed" label.
function viewedLabel(item: RecentlyViewedPost): string {
	if (!item.viewedAt) return t("history.unviewed");
	const d = new Date(item.viewedAt);
	const fmt = new Intl.DateTimeFormat(locale.value === "zh" ? "zh-CN" : "en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
	return fmt.format(d);
}
</script>

<template>
  <div class="max-w-4xl mx-auto">
    <div class="flex flex-wrap items-center justify-between gap-4 mb-8">
      <div>
        <h1 class="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Icon icon="lucide:history" class="w-7 h-7 text-violet-500" />
          {{ t('history.title') }}
        </h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {{ t('history.seoDesc') }}
        </p>
      </div>
      <button
        v-if="recent.length"
        type="button"
        class="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-red-500 dark:hover:text-red-400 transition-colors"
        @click="confirmClear = true"
      >
        <Icon icon="lucide:trash-2" class="w-4 h-4" />
        {{ t('history.clear') }}
      </button>
    </div>

    <!-- Inline clear confirmation -->
    <div
      v-if="confirmClear"
      class="mb-6 flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-red-200 dark:border-red-800 bg-red-50/60 dark:bg-red-900/20"
      role="alert"
    >
      <p class="text-sm text-red-700 dark:text-red-300">{{ t('history.clearConfirm') }}</p>
      <div class="flex gap-3">
        <button
          type="button"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-500 hover:bg-red-600 transition-colors"
          @click="clearHistory"
        >
          <Icon icon="lucide:trash-2" class="w-4 h-4" />
          {{ t('history.clearConfirmAction') }}
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          @click="confirmClear = false"
        >
          {{ t('common.action.cancel') }}
        </button>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="!recent.length" class="text-center py-20">
      <Icon icon="lucide:history" class="w-14 h-14 mx-auto mb-5 text-gray-300 dark:text-gray-600" />
      <p class="font-medium text-gray-700 dark:text-gray-200 mb-2">{{ t('history.empty') }}</p>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-7">{{ t('history.emptyDesc') }}</p>
      <NuxtLink
        to="/"
        class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 transition-all shadow-md hover:shadow-lg"
      >
        <Icon icon="lucide:book-open" class="w-4 h-4" />
        {{ t('history.browse') }}
      </NuxtLink>
    </div>

    <!-- History list -->
    <div v-else class="space-y-3">
      <NuxtLink
        v-for="item in recent"
        :key="item.slug"
        :to="`/posts/${item.slug}`"
        class="group flex items-center gap-4 p-4 rounded-2xl border border-gray-100 dark:border-gray-800 hover:border-violet-200 dark:hover:border-violet-800 hover:shadow-md transition-all duration-200"
      >
        <span class="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-900/30 text-violet-500">
          <Icon icon="lucide:book-open" class="w-5 h-5" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate font-medium text-gray-900 dark:text-gray-100 group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
            {{ item.title }}
          </p>
          <p class="mt-0.5 flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
            <Icon icon="lucide:clock" class="w-3.5 h-3.5" />
            <span class="inline-flex items-center gap-1">
              {{ viewedLabel(item) }}
              <span aria-hidden="true">·</span>
              {{ t('history.continue') }}
            </span>
          </p>
        </div>
        <Icon icon="lucide:chevron-right" class="w-5 h-5 text-gray-300 dark:text-gray-600 group-hover:text-violet-400 transition-colors shrink-0" />
      </NuxtLink>
    </div>
  </div>
</template>
