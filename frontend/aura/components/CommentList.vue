<template>
  <section>
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-xl font-bold text-gray-900 dark:text-gray-100">评论 ({{ total }})</h2>
    </div>

    <!-- Loading -->
    <div v-if="pending" class="space-y-3">
      <div v-for="i in 3" :key="i" class="animate-pulse">
        <div class="bg-gray-200 dark:bg-gray-700 h-4 rounded w-3/4 mb-2" />
        <div class="bg-gray-200 dark:bg-gray-700 h-3 rounded w-1/2" />
      </div>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="comments.length === 0"
      class="text-center py-8 text-gray-500 dark:text-gray-400"
    >
      还没有评论，来发第一个评论吧！
    </div>

    <!-- Comment list -->
    <ul v-else class="space-y-4">
      <li
        v-for="comment in comments"
        :key="comment.id"
        class="border border-gray-100 dark:border-gray-700 rounded-lg p-3"
      >
        <div class="flex items-start gap-2">
          <div class="flex-1">
            <div class="flex items-center gap-2 mb-1">
              <span class="font-medium text-sm text-gray-900 dark:text-gray-100">{{ comment.nickname }}</span>
              <span class="text-xs text-gray-500 dark:text-gray-400">{{ formatDate(comment.created_at) }}</span>
            </div>
            <p class="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{{ comment.content }}</p>
          </div>
        </div>
      </li>
    </ul>

    <!-- Pagination -->
    <nav
      v-if="totalPages > 1"
      class="flex justify-center gap-2 mt-6"
    >
      <button
        type="button"
        v-for="page in visiblePages"
        :key="page"
        @click="loadPage(page)"
        :class="[
          'px-3 py-1 rounded text-sm',
          page === currentPage
            ? 'bg-blue-600 text-white'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700',
        ]"
      >
        {{ page }}
      </button>
    </nav>
  </section>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { fetchComments } from '~/composables/useApi';

interface Props {
  postId: number;
}

const props = defineProps<Props>();

const { data: commentData, pending } = await fetchComments(props.postId, 1, 20);

const comments = computed(() => commentData.value?.items || []);
const total = computed(() => commentData.value?.total || 0);
const totalPages = computed(() => commentData.value?.total_pages || 0);
const currentPage = ref(1);

const visiblePages = computed(() => {
  const pages = [];
  const maxVisible = 5;
  let start = Math.max(1, currentPage.value - Math.floor(maxVisible / 2));
  let end = Math.min(totalPages.value, start + maxVisible - 1);
  start = Math.max(1, end - maxVisible + 1);
  for (let i = start; i <= end; i++) {
    pages.push(i);
  }
  return pages;
});

async function loadPage(page: number) {
  currentPage.value = page;
  const result = await fetchComments(props.postId, page, 20);
  commentData.value = result.data.value;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
</script>
