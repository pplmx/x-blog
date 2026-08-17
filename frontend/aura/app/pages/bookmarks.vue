<script setup lang="ts">
import { useBookmarks } from "~~/composables/useBookmarks";
import { useSeo } from "~~/composables/useSeo";

const { t, locale } = useLang();
const { bookmarks, removeBookmark, clearBookmarks, bookmarkCount } = useBookmarks();

useSeo({
	title: t("bookmarks.seoTitle"),
	description: t("bookmarks.seoDesc"),
	path: "/bookmarks",
});

function handleClearAll() {
	if (confirm(t("bookmarks.confirmClear"))) {
		clearBookmarks();
	}
}
</script>

<template>
  <div class="max-w-5xl mx-auto px-4 py-12">
    <!-- Header -->
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1
          class="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent"
        >
          {{ t('bookmarks.title') }}
        </h1>
        <p v-if="bookmarkCount > 0" class="text-sm text-gray-500 dark:text-gray-400 mt-2">
          {{ t('bookmarks.countLabel', { count: bookmarkCount }) }}
        </p>
      </div>
      <button
        v-if="bookmarkCount > 0"
        type="button"
        @click="handleClearAll"
        class="text-sm text-gray-500 hover:text-red-500 transition-colors"
        :title="t('bookmarks.clearAll')"
      >
        <Icon icon="lucide:trash-2" class="w-4 h-4 inline mr-1" />
        {{ t('bookmarks.clearAll') }}
      </button>
    </div>

    <!-- Empty state -->
    <div
      v-if="bookmarkCount === 0"
      class="text-center py-16 text-gray-500 dark:text-gray-400"
    >
      <Icon icon="lucide:bookmark" class="w-12 h-12 mx-auto mb-4 text-gray-300" />
      <p class="text-lg mb-4">{{ t('bookmarks.empty') }}</p>
      <NuxtLink
        to="/"
        class="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors"
      >
        <Icon icon="lucide:arrow-left" class="w-4 h-4" />
        {{ t('bookmarks.browse') }}
      </NuxtLink>
    </div>

    <!-- Bookmarks list -->
    <div
      v-else
      class="space-y-4"
    >
      <div
        v-for="bookmark in bookmarks"
        :key="bookmark.id"
        class="border border-gray-100 dark:border-gray-800 rounded-2xl p-4 hover:shadow-md transition-shadow"
      >
        <div class="flex items-start gap-4">
          <!-- Bookmark data -->
          <div class="flex-1">
            <NuxtLink
              :to="`/posts/${bookmark.slug}`"
              class="text-xl font-bold text-gray-900 dark:text-gray-100 hover:text-blue-600 transition-colors line-clamp-2"
            >
              {{ bookmark.title }}
            </NuxtLink>

            <p
              v-if="bookmark.excerpt"
              class="text-gray-600 dark:text-gray-300 mt-2 text-sm line-clamp-2"
            >
              {{ bookmark.excerpt }}
            </p>

            <div class="flex items-center gap-4 mt-3 text-sm text-gray-500 dark:text-gray-400">
              <span v-if="bookmark.category" class="flex items-center gap-1">
                <Icon icon="lucide:folder" class="w-4 h-4" />
                {{ bookmark.category.name }}
              </span>
              <span class="flex items-center gap-1">
                <Icon icon="lucide:calendar" class="w-4 h-4" />
                {{ new Date(bookmark.created_at).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", { year: 'numeric', month: 'long', day: 'numeric' }) }}
              </span>
            </div>

            <div class="mt-2 flex flex-wrap gap-2">
              <span
                v-for="tag in bookmark.tags"
                :key="tag.id"
                class="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full"
              >
                #{{ tag.name }}
              </span>
            </div>
          </div>

          <!-- Remove button -->
          <button
            type="button"
            @click.stop="removeBookmark(bookmark.id)"
            :title="t('bookmarks.remove')"
            class="shrink-0 p-2 text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
          >
            <Icon icon="lucide:x" class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
