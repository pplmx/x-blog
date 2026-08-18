<script setup lang="ts">
import { useSeries } from "~~/composables/useApi";
import { useSeo } from "~~/composables/useSeo";

const { t } = useLang();
const { data: series, pending, error } = await useSeries();

useSeo(() => ({
	title: t("series.all"),
	description: t("series.allDesc"),
	path: "/series",
}));
</script>

<template>
  <div class="max-w-5xl mx-auto">
    <!-- Loading state -->
    <div v-if="pending" class="space-y-4">
      <div class="bg-gray-100 dark:bg-gray-800 animate-pulse h-8 rounded-lg mb-4 w-1/3" />
      <div class="grid gap-4 sm:grid-cols-2">
        <div
          v-for="i in 4"
          :key="i"
          class="bg-gray-100 dark:bg-gray-800 animate-pulse h-32 rounded-2xl"
        />
      </div>
    </div>

    <div v-else-if="error" class="text-center py-20 text-gray-500">
      <Icon icon="lucide:alert-circle" class="w-12 h-12 mx-auto mb-4 text-gray-300" />
      <p>{{ t('common.state.loadFailed') }}</p>
    </div>

    <div v-else class="space-y-6">
      <div class="mb-8">
        <h1
          class="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent mb-2"
        >
          {{ t('series.all') }}
        </h1>
        <p class="text-gray-500 dark:text-gray-400">
          {{ t('series.countLabel', { count: series?.length || 0 }) }}
        </p>
      </div>

      <div
        v-if="series?.length"
        class="grid gap-4 sm:grid-cols-2"
      >
        <NuxtLink
          v-for="s in series"
          :key="s.id"
          :to="`/series/${s.slug}`"
          class="group p-6 rounded-2xl border border-gray-100 dark:border-gray-800 hover:border-blue-200 dark:hover:border-blue-800 hover:shadow-lg transition-all duration-200"
        >
          <div class="flex items-start justify-between gap-4">
            <h2 class="text-lg font-bold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-2">
              {{ s.title }}
            </h2>
            <Icon icon="lucide:arrow-right" class="w-5 h-5 text-gray-300 group-hover:text-blue-600 group-hover:translate-x-1 transition-all duration-300 shrink-0" />
          </div>
          <p v-if="s.description" class="text-sm text-gray-500 dark:text-gray-400 mt-2 line-clamp-2">
            {{ s.description }}
          </p>
          <div class="flex items-center gap-3 mt-4 text-xs text-gray-400">
            <span class="inline-flex items-center gap-1">
              <Icon icon="lucide:layers" class="w-3.5 h-3.5" />
              {{ t('series.countLabel', { count: s.post_count }) }}
            </span>
          </div>
        </NuxtLink>
      </div>

      <div
        v-else
        class="text-center py-12 text-gray-500"
      >
        {{ t('series.empty') }}
      </div>
    </div>
  </div>
</template>
