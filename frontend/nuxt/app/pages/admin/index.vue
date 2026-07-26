<!--
  Admin Dashboard Page
  Migrated from Next.js /app/admin/page.tsx to Nuxt 4 / Vue 3.
  Fetches posts, categories, and tags in parallel for an overview dashboard.
-->
<script setup lang="ts">
import { fetchPosts, useCategories, useTags } from '~/composables/useApi';

// Fetch all data in parallel
const [postsResponse, categoriesResult, tagsResult] = await Promise.all([
  fetchPosts({ limit: 1000 }),
  useCategories(),
  useTags(),
]);

const posts = postsResponse.items;
const categories = categoriesResult.data.value;
const tags = tagsResult.data.value;

const publishedCount = posts.filter((p) => p.published).length;
const draftCount = posts.length - publishedCount;
const totalViews = posts.reduce((sum, p) => sum + (p.views || 0), 0);

// Recent 5 published posts sorted by date (newest first)
const recentPosts = posts
  .filter((p) => p.published)
  .sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )
  .slice(0, 5);

// Top 5 posts by view count
const topPosts = [...posts].sort(
  (a, b) => (b.views || 0) - (a.views || 0),
);

// Helper: count posts per category
function postsInCategory(catId: number): number {
  return posts.filter((p) => p.category?.id === catId).length;
}

const stats = [
  { title: '文章总数', value: posts.length, icon: 'lucide:file-text', color: 'text-blue-600', bg: 'bg-blue-50' },
  { title: '已发布', value: publishedCount, icon: 'lucide:check-circle', color: 'text-green-600', bg: 'bg-green-50' },
  { title: '草稿', value: draftCount, icon: 'lucide:clock', color: 'text-yellow-600', bg: 'bg-yellow-50' },
  { title: '分类', value: categories?.length || 0, icon: 'lucide:folder', color: 'text-purple-600', bg: 'bg-purple-50' },
  { title: '标签', value: tags?.length || 0, icon: 'lucide:tag', color: 'text-pink-600', bg: 'bg-pink-50' },
  { title: '总浏览量', value: totalViews, icon: 'lucide:eye', color: 'text-orange-600', bg: 'bg-orange-50' },
];
</script>

<template>
  <div>
    <div class="mb-8">
      <h1
        class="text-2xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent"
      >
        仪表盘
      </h1>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
        博客数据总览
      </p>
    </div>

    <!-- Stats cards -->
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-8">
      <div
        v-for="stat in stats"
        :key="stat.title"
        class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5 hover:shadow-lg hover:border-gray-200 dark:hover:border-gray-700 transition-all duration-200"
      >
        <div class="flex items-center justify-between mb-3">
          <span class="text-sm font-medium text-gray-500 dark:text-gray-400">
            {{ stat.title }}
          </span>
          <div :class="['p-2.5 rounded-xl', stat.bg]">
            <Icon :icon="stat.icon" :class="['h-5 w-5', stat.color]" />
          </div>
        </div>
        <div class="text-3xl font-bold text-gray-900 dark:text-gray-100">
          {{ stat.value }}
        </div>
      </div>
    </div>

    <!-- Top posts by views + Category distribution -->
    <div class="grid gap-6 lg:grid-cols-2 mb-8">
      <div class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
          <Icon icon="lucide:file-text" class="w-5 h-5 text-blue-500" />
          热门文章 (浏览量)
        </h3>
        <div class="space-y-3">
          <div
            v-for="post in topPosts.slice(0, 5)"
            :key="post.id"
            class="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <span class="font-medium text-gray-900 dark:text-gray-100 truncate">
              {{ post.title }}
            </span>
            <span class="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1">
              <Icon icon="lucide:eye" class="w-4 h-4" />
              {{ post.views || 0 }}
            </span>
          </div>
        </div>
      </div>

      <!-- Category distribution -->
      <div class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
          <Icon icon="lucide:folder" class="w-5 h-5 text-purple-500" />
          文章分类分布
        </h3>
        <div class="space-y-3">
          <div
            v-for="cat in categories"
            :key="cat.id"
            class="flex items-center gap-3"
          >
            <span class="text-sm text-gray-700 dark:text-gray-300 w-20 truncate">
              {{ cat.name }}
            </span>
            <div class="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div
                class="bg-purple-500 h-2 rounded-full transition-all"
                :style="{ width: (postsInCategory(cat.id) / (posts.length || 1) * 100) + '%' }"
              />
            </div>
            <span class="text-sm text-gray-500 dark:text-gray-400 w-8 text-right">
              {{ postsInCategory(cat.id) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Recent posts -->
    <div class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5">
      <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
        <Icon icon="lucide:clock" class="w-5 h-5 text-green-500" />
        最近发布的文章
      </h3>
      <div v-if="recentPosts.length === 0" class="text-gray-500 dark:text-gray-400 text-sm">
        暂无已发布的文章
      </div>
      <div v-else class="space-y-2">
        <NuxtLink
          v-for="post in recentPosts"
          :key="post.id"
          :to="`/admin/posts/${post.id}`"
          class="flex items-center justify-between p-4 rounded-xl hover:bg-gradient-to-r hover:from-blue-50 hover:to-indigo-50 dark:hover:from-blue-900/10 dark:hover:to-indigo-900/10 transition-colors group"
        >
          <div>
            <p
              class="font-medium text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors"
            >
              {{ post.title }}
            </p>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              {{ new Date(post.created_at).toLocaleDateString('zh-CN') }}
            </p>
          </div>
          <div class="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500">
            <Icon icon="lucide:eye" class="w-4 h-4" />
            {{ post.views || 0 }}
          </div>
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
