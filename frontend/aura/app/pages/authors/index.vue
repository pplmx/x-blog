<script setup lang="ts">
import { useAuthors } from "~~/api/public/authors";
import { useSeo } from "~~/composables/useSeo";

const { t } = useLang();

const { data: authors, pending, error, refresh: refreshAuthors } = await useAuthors();

useSeo(() => ({
	title: t("authors.indexTitle"),
	description: t("authors.indexDesc"),
	path: "/authors",
}));

function retry() {
	void refreshAuthors();
}
</script>

<template>
  <div class="max-w-5xl mx-auto">
    <div class="mb-8">
      <h1
        class="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent mb-2 flex items-center gap-3"
      >
        <Icon icon="lucide:users" class="w-8 h-8 text-gray-400" />
        {{ t("authors.indexTitle") }}
      </h1>
      <p class="text-gray-500 dark:text-gray-400">
        {{ t("authors.indexDesc") }}
      </p>
    </div>

    <!-- Loading skeleton -->
    <div v-if="pending" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-busy="true">
      <div v-for="i in 4" :key="i" class="rounded-2xl border border-gray-100 dark:border-gray-800 p-5 h-24 animate-pulse bg-gray-100 dark:bg-gray-800" />
    </div>

    <!-- Load failed — never read "no authors" into a network failure. -->
    <div v-else-if="error" class="text-center py-16 text-gray-500" role="alert">
      <Icon icon="lucide:alert-circle" class="w-12 h-12 mx-auto mb-3 text-gray-300" />
      <p class="mb-4">{{ t("common.state.loadFailed") }}</p>
      <button
        type="button"
        class="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        @click="retry"
      >
        {{ t("common.action.retry") }}
      </button>
    </div>

    <div v-else-if="!authors?.length" class="text-center py-16 text-gray-500">
      <Icon icon="lucide:users" class="w-12 h-12 mx-auto mb-3 text-gray-300" />
      <p>{{ t("authors.indexEmpty") }}</p>
    </div>

    <!-- Writers grid (round 346): each card is the writer's archive door. -->
    <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <NuxtLink
        v-for="a in authors"
        :key="a.id"
        :to="`/authors/${a.id}`"
        class="group flex items-center gap-4 p-5 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 hover:border-blue-200 dark:hover:border-blue-800 hover:shadow-lg transition-all duration-200"
      >
        <span
          class="w-12 h-12 shrink-0 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center text-lg font-bold"
        >
          {{ a.display_name.slice(0, 1) }}
        </span>
        <span class="min-w-0">
          <span class="block font-medium text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 truncate">
            {{ a.display_name }}
          </span>
          <span class="block text-sm text-gray-500 dark:text-gray-400">
            {{ t("authors.postCount", { count: a.post_count }) }}
          </span>
        </span>
      </NuxtLink>
    </div>
  </div>
</template>
