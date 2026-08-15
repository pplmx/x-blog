<script setup lang="ts">
// Real 404: set the HTTP status (soft-404s get indexed by search engines)
// and give the page a proper localized title/description.
const { t } = useLang();
if (import.meta.server) {
	setResponseStatus(404);
}
useHead({
	title: t("post.notFoundTitle"),
	meta: [{ name: "description", content: t("post.notFoundDesc") }],
});
</script>

<template>
  <div class="min-h-[70vh] flex items-center justify-center px-4">
    <div class="text-center max-w-md">
      <div class="relative mb-10 select-none">
        <div class="text-[10rem] sm:text-[12rem] font-bold bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 bg-clip-text text-transparent leading-none">
          404
        </div>
        <div class="absolute inset-0 flex items-center justify-center">
          <div class="w-40 h-40 border-4 border-gray-100 dark:border-gray-800 rounded-full animate-spin border-t-blue-500 opacity-50" style="animation-duration: 3s" />
        </div>
      </div>

      <h2 class="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-3">
        {{ t('post.notFoundHeading') }}
      </h2>
      <p class="text-gray-500 dark:text-gray-400 mb-8 max-w-sm mx-auto leading-relaxed">
        {{ t('post.notFoundDesc') }}
      </p>

      <div class="flex flex-col sm:flex-row gap-3 justify-center">
        <NuxtLink
          to="/"
          class="inline-flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-medium hover:from-blue-600 hover:to-indigo-600 transition-all shadow-md hover:shadow-lg active:scale-[0.98]"
        >
          <Icon icon="lucide:home" class="w-4 h-4" />
          {{ t('common.action.backHome') }}
        </NuxtLink>
        <NuxtLink
          to="/search"
          class="inline-flex items-center justify-center gap-2 px-6 py-3 border border-gray-200 dark:border-gray-700 rounded-xl font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          <Icon icon="lucide:search" class="w-4 h-4" />
          {{ t('post.searchArticles') }}
        </NuxtLink>
        <NuxtLink
          to="/about"
          class="inline-flex items-center justify-center gap-2 px-6 py-3 border border-gray-200 dark:border-gray-700 rounded-xl font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          <Icon icon="lucide:info" class="w-4 h-4" />
          {{ t('post.about') }}
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
