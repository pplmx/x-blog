<script setup lang="ts">
import { usePost, usePostView } from '../../../composables/useApi';

const route = useRoute();
const { data: post, pending, error } = await usePost(route.params.slug as string);

// Track view count when post is loaded
if (post.value?.id) {
  await usePostView(post.value.id);
}
</script>

<template>
  <div class="max-w-3xl mx-auto">
    <!-- Back link -->
    <NuxtLink
      to="/"
      class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-600 transition-colors mb-6"
    >
      <Icon icon="lucide:arrow-left" class="w-4 h-4" />
      返回首页
    </NuxtLink>

    <!-- Loading state -->
    <div v-if="pending" class="space-y-4">
      <div class="bg-gray-100 animate-pulse h-8 rounded-lg w-3/4"></div>
      <div class="bg-gray-100 animate-pulse h-64 rounded-lg"></div>
      <div class="bg-gray-100 animate-pulse h-4 rounded-lg"></div>
      <div class="bg-gray-100 animate-pulse h-4 rounded-lg"></div>
      <div class="bg-gray-100 animate-pulse h-4 rounded-lg w-5/6"></div>
    </div>

    <!-- Error state -->
    <div
      v-else-if="error"
      class="text-center py-12 text-gray-500"
    >
      加载失败: {{ error.message }}
    </div>

    <!-- Post not found -->
    <div
      v-else-if="!post"
      class="text-center py-12 text-gray-500"
    >
      文章不存在
    </div>

    <!-- Post content -->
    <article v-else class="prose prose-lg max-w-none">
      <header class="mb-8">
        <h1 class="text-3xl sm:text-4xl font-bold text-gray-900 mb-6 leading-tight">
          {{ post.title }}
        </h1>

        <div class="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-gray-600 mb-6">
          <span v-if="post.category" class="flex items-center gap-2">
            <Icon icon="lucide:folder" class="w-4 h-4" />
            {{ post.category.name }}
          </span>
          <span class="flex items-center gap-2">
            <Icon icon="lucide:calendar" class="w-4 h-4" />
            {{ new Date(post.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) }}
          </span>
          <span class="flex items-center gap-2">
            <Icon icon="lucide:eye" class="w-4 h-4" />
            {{ post.views }} 次阅读
          </span>
        </div>

        <div
          v-if="post.excerpt"
          class="text-xl text-gray-600 leading-relaxed mb-6"
        >
          {{ post.excerpt }}
        </div>
      </header>

      <!-- Markdown content -->
      <div
        v-if="post.content"
        class="mt-8 text-gray-800 leading-relaxed"
        v-html="post.content"
      ></div>

      <!-- Tags -->
      <footer v-if="post.tags && post.tags.length" class="mt-12 pt-8 border-t border-gray-200">
        <div class="flex flex-wrap gap-2">
          <span
            v-for="tag in post.tags"
            :key="tag.id"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full text-sm"
          >
            <Icon icon="lucide:tag" class="w-3.5 h-3.5" />
            {{ tag.name }}
          </span>
        </div>
      </footer>
    </article>
  </div>
</template>

<route lang="json">
{
  "meta": {
    "title": "文章详情",
    "description": "X-Blog - 技术博客文章详情"
  }
}
</route>
