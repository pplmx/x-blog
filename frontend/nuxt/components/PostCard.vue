<script setup lang="ts">
import type { PostList } from '~/composables/useApi';

interface Props {
  post: PostList;
}

const props = withDefaults(defineProps<Props>(), {});
const { post } = toRefs(props);

// Default placeholder gradient based on post title hash
function getGradientFromTitle(title: string): string {
  const gradients = [
    'from-blue-500 to-indigo-600',
    'from-emerald-500 to-teal-600',
    'from-orange-500 to-red-600',
    'from-purple-500 to-pink-600',
    'from-cyan-500 to-blue-600',
  ];
  const hash = title.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return gradients[hash % gradients.length];
}

const date = computed(() =>
  new Date(props.post.created_at).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
);
</script>

<template>
  <article class="group border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden hover:border-gray-200 dark:hover:border-gray-700 hover:shadow-xl hover:shadow-gray-100/50 dark:hover:shadow-gray-900/50 transition-all duration-300 bg-white dark:bg-gray-900">
    <NuxtLink :to="`/posts/${post.slug}`">
      <!-- Cover Image -->
      <div v-if="post.cover_image" class="relative h-48 w-full overflow-hidden">
        <img
          :src="post.cover_image"
          :alt="post.title"
          class="object-cover w-full h-full group-hover:scale-105 transition-transform duration-500"
        />
      </div>
      <div v-else :class="`h-32 bg-gradient-to-br ${getGradientFromTitle(post.title)} opacity-80`">
        <div class="w-full h-full flex items-center justify-center">
          <span class="text-4xl font-bold text-white/30">
            {{ post.title.charAt(0).toUpperCase() }}
          </span>
        </div>
      </div>

      <div class="p-6">
        <div class="flex items-start justify-between gap-4 mb-3">
          <h2 class="text-xl font-bold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 transition-colors duration-200 line-clamp-2">
            {{ post.title }}
          </h2>
          <Icon icon="lucide:arrow-right" class="w-5 h-5 text-gray-300 group-hover:text-blue-600 group-hover:translate-x-1 transition-all duration-300 shrink-0" />
        </div>

        <div class="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400 mb-4">
          <span class="flex items-center gap-1">
            <Icon icon="lucide:calendar" class="w-4 h-4" />
            {{ date }}
          </span>
          <span v-if="post.category"
            class="px-3 py-1 bg-gradient-to-r from-gray-50 dark:from-gray-800 to-gray-100 dark:to-gray-700 rounded-full text-xs font-medium text-gray-600 dark:text-gray-300">
            {{ post.category.name }}
          </span>
          <span class="flex items-center gap-1 ml-auto">
            <Icon icon="lucide:eye" class="w-4 h-4" />
            {{ post.views || 0 }}
          </span>
        </div>

        <p v-if="post.excerpt"
          class="text-gray-600 dark:text-gray-300 mb-4 line-clamp-2 leading-relaxed">
          {{ post.excerpt }}
        </p>

        <div class="flex flex-wrap gap-2 pt-2 border-t border-gray-50 dark:border-gray-800">
          <span v-for="tag in post.tags" :key="tag.id"
            class="text-xs px-3 py-1.5 bg-gradient-to-r from-blue-50 dark:from-blue-900/30 to-indigo-50 dark:to-indigo-900/30 text-blue-600 dark:text-blue-400 rounded-full font-medium hover:from-blue-100 dark:hover:from-blue-900/50 hover:to-indigo-100 dark:hover:to-indigo-900/50 transition-colors duration-200">
            #{{ tag.name }}
          </span>
        </div>
      </div>
    </NuxtLink>
  </article>
</template>
