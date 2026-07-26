<script setup lang="ts">
defineProps<{
  /** Skeleton type to render */
  type: 'post-list' | 'post-detail' | 'sidebar' | 'page'
}>()
</script>

<template>
  <!-- Post list skeleton -->
  <div v-if="type === 'post-list'" class="space-y-8">
    <div v-for="i in 5" :key="i" class="bg-white dark:bg-gray-900 rounded-lg shadow-sm p-6">
      <div class="animate-pulse space-y-4">
        <div class="h-6 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
        <div class="flex items-center gap-4">
          <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20" />
          <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-16" />
        </div>
        <div class="space-y-2">
          <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded" />
          <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
        </div>
        <div class="flex gap-2">
          <div class="h-6 bg-gray-200 dark:bg-gray-700 rounded w-16" />
          <div class="h-6 bg-gray-200 dark:bg-gray-700 rounded w-20" />
        </div>
      </div>
    </div>
  </div>

  <!-- Post detail skeleton -->
  <article v-else-if="type === 'post-detail'" class="max-w-3xl mx-auto">
    <div class="animate-pulse space-y-6">
      <div class="space-y-4">
        <div class="h-10 bg-gray-200 dark:bg-gray-700 rounded w-full" />
        <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
      </div>
      <div class="h-64 bg-gray-200 dark:bg-gray-700 rounded-lg" />
      <div class="space-y-3">
        <div
          v-for="i in 8" :key="i" class="h-4 bg-gray-200 dark:bg-gray-700 rounded"
          :style="{ width: `${70 + Math.random() * 30}%` }"
        />
      </div>
    </div>
  </article>

  <!-- Sidebar skeleton -->
  <aside v-else-if="type === 'sidebar'" class="space-y-8">
    <div class="bg-white dark:bg-gray-900 rounded-lg p-4">
      <div class="h-5 bg-gray-200 dark:bg-gray-700 rounded w-20 mb-4" />
      <div class="animate-pulse space-y-2">
        <div v-for="i in 4" :key="i" class="h-4 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    </div>
    <div class="bg-white dark:bg-gray-900 rounded-lg p-4">
      <div class="h-5 bg-gray-200 dark:bg-gray-700 rounded w-16 mb-4" />
      <div class="flex flex-wrap gap-2 animate-pulse">
        <div v-for="i in 8" :key="i" class="h-6 bg-gray-200 dark:bg-gray-700 rounded-full w-16" />
      </div>
    </div>
    <div class="bg-white dark:bg-gray-900 rounded-lg p-4">
      <div class="h-5 bg-gray-200 dark:bg-gray-700 rounded w-24 mb-4" />
      <div class="animate-pulse space-y-3">
        <div v-for="i in 3" :key="i" class="space-y-1">
          <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full" />
          <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
        </div>
      </div>
    </div>
  </aside>

  <!-- Full page skeleton -->
  <div v-else class="flex flex-col lg:flex-row gap-8">
    <div class="flex-1">
      <Skeleton type="post-list" />
    </div>
    <div class="w-full lg:w-64 shrink-0">
      <Skeleton type="sidebar" />
    </div>
  </div>
</template>
