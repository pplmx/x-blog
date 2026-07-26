<!--
  Admin Posts List Page
  Migrated from Next.js /app/admin/posts/page.tsx to Nuxt 4 / Vue 3.
  Uses Nuxt's useFetch for data fetching (no React Query needed).
-->
<script setup lang="ts">
import { ref } from 'vue';
import { fetchAdminPosts, deleteAdminPost } from '~/composables/useApi';

const { data: posts, pending, error, refresh } = await fetchAdminPosts();
const isDeleting = ref(false);

async function handleDelete(id: number) {
  if (!confirm('确定要删除这篇文章吗？')) return;
  isDeleting.value = true;
  try {
    await deleteAdminPost(id);
    await refresh();
  } finally {
    isDeleting.value = false;
  }
}
</script>

<template>
  <div>
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
      <div>
        <h1
          class="text-2xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent"
        >
          文章管理
        </h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
          共 {{ posts?.length || 0 }} 篇文章
        </p>
      </div>
      <NuxtLink
        to="/admin/posts/new"
        class="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-medium hover:from-blue-600 hover:to-indigo-600 shadow-md shadow-blue-500/20 transition-all"
      >
        <Icon icon="lucide:plus" class="w-4 h-4" />
        新建文章
      </NuxtLink>
    </div>

    <!-- Loading state -->
    <div v-if="pending" class="text-center py-12">
      <div class="inline-flex items-center gap-2 text-gray-500">
        <svg aria-label="加载中" class="animate-spin w-5 h-5" viewBox="0 0 24 24">
          <circle
            class="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            stroke-width="4"
            fill="none"
          />
          <path
            class="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        加载中...
      </div>
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="text-center py-12 text-red-500">
      {{ error?.message || String(error) }}
    </div>

    <!-- Empty state -->
    <div
      v-else-if="!posts || posts.length === 0"
      class="flex flex-col items-center justify-center py-16 bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800"
    >
      <div class="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
        <Icon icon="lucide:file-text" class="w-8 h-8 text-gray-400" />
      </div>
      <h3 class="text-lg font-medium text-gray-700 dark:text-gray-300 mb-1">
        暂无文章
      </h3>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
        开始创建你的第一篇文章吧
      </p>
      <NuxtLink to="/admin/posts/new">
        <button
          type="button"
          class="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          <Icon icon="lucide:plus" class="w-4 h-4" />
          新建文章
        </button>
      </NuxtLink>
    </div>

    <!-- Posts table -->
    <div
      v-else
      class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden shadow-sm"
    >
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr
              class="bg-gradient-to-r from-gray-50 dark:from-gray-800 to-white dark:to-gray-950 border-b border-gray-100 dark:border-gray-800"
            >
              <th
                class="px-5 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider"
              >
                标题
              </th>
              <th
                class="px-5 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden md:table-cell"
              >
                Slug
              </th>
              <th
                class="px-5 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider"
              >
                状态
              </th>
              <th
                class="px-5 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell"
              >
                日期
              </th>
              <th
                class="px-5 py-4 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider"
              >
                操作
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50 dark:divide-gray-800">
            <tr
              v-for="post in posts"
              :key="post.id"
              class="hover:bg-gradient-to-r hover:from-blue-50/50 hover:to-indigo-50/50 dark:hover:from-blue-900/10 dark:hover:to-indigo-900/10 transition-colors"
            >
              <td class="px-5 py-4">
                <span
                  class="font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer"
                >
                  {{ post.title }}
                </span>
              </td>
              <td class="px-5 py-4 hidden md:table-cell">
                <code
                  class="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded font-mono text-gray-600 dark:text-gray-400"
                >
                  {{ post.slug }}
                </code>
              </td>
              <td class="px-5 py-4">
                <span
                  :class="[
                    'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium',
                    post.published
                      ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                      : 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
                  ]"
                >
                  <span
                    :class="[
                      'w-1.5 h-1.5 rounded-full mr-1.5',
                      post.published ? 'bg-green-500' : 'bg-amber-500',
                    ]"
                  />
                  {{ post.published ? '已发布' : '草稿' }}
                </span>
              </td>
              <td class="px-5 py-4 text-sm text-gray-500 dark:text-gray-400 hidden sm:table-cell">
                {{ new Date(post.created_at).toLocaleDateString('zh-CN') }}
              </td>
              <td class="px-5 py-4 text-right">
                <div class="flex items-center justify-end gap-1">
                  <NuxtLink :to="`/admin/posts/${post.id}`">
                    <button
                      type="button"
                      class="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                    >
                      <Icon icon="lucide:pencil" class="h-4 w-4" />
                    </button>
                  </NuxtLink>
                  <button
                    type="button"
                    :disabled="isDeleting"
                    class="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                    @click="handleDelete(post.id)"
                  >
                    <Icon icon="lucide:trash-2" class="h-4 w-4" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
