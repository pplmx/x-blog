<!--
  Admin Comments Page
  Migrated from Next.js /app/admin/comments/page.tsx to Nuxt 4 / Vue 3.
-->
<script setup lang="ts">
import { fetchAdminComments, deleteAdminComment, approveAdminComment } from '~/composables/useApi';

const { data: comments, pending, error, refresh } = await fetchAdminComments();
const isProcessing = ref(false);

async function handleDelete(id: number) {
  if (!confirm('确定要删除这条评论吗？')) return;
  isProcessing.value = true;
  try {
    await deleteAdminComment(id);
    await refresh();
  } finally {
    isProcessing.value = false;
  }
}

async function handleApprove(id: number, approved: boolean) {
  isProcessing.value = true;
  try {
    await approveAdminComment(id, approved);
    await refresh();
  } finally {
    isProcessing.value = false;
  }
}
</script>

<template>
  <div>
    <div class="mb-8">
      <h1
        class="text-2xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent"
      >
        评论管理
      </h1>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
        共 {{ comments?.length || 0 }} 条评论
      </p>
    </div>

    <div v-if="pending" class="text-center py-12">
      <div class="inline-flex items-center gap-2 text-gray-500">
        <Icon icon="lucide:loader-2" class="w-5 h-5 animate-spin" />
        加载中...
      </div>
    </div>

    <div v-else-if="error" class="text-center py-12 text-red-500">
      {{ error?.message || String(error) }}
    </div>

    <div
      v-else-if="!comments || comments.length === 0"
      class="flex flex-col items-center justify-center py-16 bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800"
    >
      <Icon icon="lucide:message-circle" class="w-12 h-12 text-gray-400 mb-4" />
      <h3 class="text-lg font-medium text-gray-700 dark:text-gray-300 mb-1">
        暂无评论
      </h3>
      <p class="text-sm text-gray-500 dark:text-gray-400">
        还没有任何评论
      </p>
    </div>

    <div
      v-else
      class="space-y-4"
    >
      <div
        v-for="comment in comments"
        :key="comment.id"
        class="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-6 shadow-sm"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1">
            <div class="flex items-center gap-3 mb-3">
              <span class="font-medium text-gray-900 dark:text-gray-100">
                {{ comment.nickname }}
              </span>
              <span class="text-sm text-gray-500 dark:text-gray-400">
                {{ comment.email }}
              </span>
              <span
                :class="[
                  'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                  comment.is_approved
                    ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                    : 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
                ]"
              >
                {{ comment.is_approved ? '已审核' : '待审核' }}
              </span>
            </div>

            <p class="text-gray-700 dark:text-gray-300 mb-3">
              {{ comment.content }}
            </p>

            <div class="text-sm text-gray-500 dark:text-gray-400 space-y-1">
              <p>
                <span class="font-medium">所属文章：</span>
                {{ comment.post_title }}
              </p>
              <p>
                <span class="font-medium">IP地址：</span>
                {{ comment.ip_address }}
              </p>
              <p>
                <span class="font-medium">时间：</span>
                {{ new Date(comment.created_at).toLocaleString('zh-CN') }}
              </p>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <button
              v-if="!comment.is_approved"
              type="button"
              :disabled="isProcessing"
              class="px-4 py-2 text-sm bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/50 transition-colors"
              @click="handleApprove(comment.id, true)"
            >
              审核通过
            </button>
            <button
              v-if="comment.is_approved"
              type="button"
              :disabled="isProcessing"
              class="px-4 py-2 text-sm bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors"
              @click="handleApprove(comment.id, false)"
            >
              取消审核
            </button>
            <button
              type="button"
              :disabled="isProcessing"
              class="px-4 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
              @click="handleDelete(comment.id)"
            >
              删除
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
