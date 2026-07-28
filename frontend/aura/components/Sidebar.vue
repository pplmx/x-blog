<script setup lang="ts">
import type { Category, PostList, Tag } from "~~/composables/useApi";

interface Props {
	categories: Category[];
	tags: Tag[];
	popularPosts?: PostList[];
}

const props = withDefaults(defineProps<Props>(), {
	popularPosts: () => [],
});

const { categories, tags, popularPosts } = toRefs(props);
const { bookmarkCount } = useBookmarks();

const route = useRoute();
const currentCategory = route.query.category_id;
const currentTag = route.query.tag_id;

function clearFilters() {
	navigateTo("/");
}
</script>

<template>
  <aside class="w-64 shrink-0 space-y-6">
    <!-- Clear filters button -->
    <button
      v-if="currentCategory || currentTag"
      @click="clearFilters"
      class="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 transition-colors mb-2"
    >
      <Icon icon="lucide:x" class="w-4 h-4" />
      清除筛选
    </button>

    <!-- Popular posts -->
    <div
      v-if="popularPosts.length > 0"
      class="bg-gradient-to-br from-gray-50 dark:from-gray-800 to-white dark:to-gray-900 rounded-2xl p-5 border border-gray-100 dark:border-gray-800"
    >
      <h3 class="flex items-center gap-2 font-bold text-gray-900 dark:text-gray-100 mb-4">
        <Icon icon="lucide:trending-up" class="w-5 h-5 text-orange-500" />
        热门文章
      </h3>
      <div class="space-y-3">
        <NuxtLink
          v-for="(post, index) in popularPosts"
          :key="post.id"
          :to="`/posts/${post.slug}`"
          class="group flex items-start gap-3 p-2 -mx-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-200"
        >
          <span
            class="flex items-center justify-center w-6 h-6 bg-gradient-to-br from-orange-100 dark:from-orange-900/50 to-red-100 dark:to-red-900/50 text-orange-600 dark:text-orange-400 text-xs font-bold rounded-full group-hover:from-orange-200 group-hover:to-red-200"
          >
            {{ index + 1 }}
          </span>
          <div class="flex-1 min-w-0">
            <p
              class="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-blue-600 transition-colors line-clamp-2"
            >
              {{ post.title }}
            </p>
            <p class="text-xs text-gray-400 mt-1">{{ post.views }} 次阅读</p>
          </div>
        </NuxtLink>
      </div>
    </div>

    <!-- Categories -->
    <div
      class="bg-gradient-to-br from-gray-50 dark:from-gray-800 to-white dark:to-gray-900 rounded-2xl p-5 border border-gray-100 dark:border-gray-800"
    >
      <h3 class="flex items-center gap-2 font-bold text-gray-900 dark:text-gray-100 mb-4">
        <Icon icon="lucide:folder-open" class="w-5 h-5 text-purple-500" />
        分类
      </h3>
      <div class="space-y-1">
        <NuxtLink
          v-for="cat in categories"
          :key="cat.id"
          :to="[`?category_id=${cat.id}`]"
          :class="[
            'block px-3 py-2 rounded-xl text-sm transition-all duration-200',
            currentCategory === String(cat.id)
              ? 'bg-gradient-to-r from-purple-500 to-indigo-500 text-white shadow-md'
              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-purple-600',
          ]"
        >
          {{ cat.name }}
        </NuxtLink>
      </div>
    </div>

    <!-- Bookmarks -->
    <NuxtLink
      to="/bookmarks"
      class="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
    >
      <Icon icon="lucide:bookmark" class="w-4 h-4" />
      <span>收藏的文章</span>
      <span
        v-if="bookmarkCount > 0"
        class="ml-auto bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs px-2 py-0.5 rounded-full"
      >
        {{ bookmarkCount }}
      </span>
    </NuxtLink>

    <!-- Tags -->
    <div
      class="bg-gradient-to-br from-gray-50 dark:from-gray-800 to-white dark:to-gray-900 rounded-2xl p-5 border border-gray-100 dark:border-gray-800"
    >
      <h3 class="flex items-center gap-2 font-bold text-gray-900 dark:text-gray-100 mb-4">
        <Icon icon="lucide:tag" class="w-5 h-5 text-pink-500" />
        标签
      </h3>
      <div class="flex flex-wrap gap-2">
        <NuxtLink
          v-for="tag in tags"
          :key="tag.id"
          :to="[`?tag_id=${tag.id}`]"
          :class="[
            'px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200',
            currentTag === String(tag.id)
              ? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-md'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gradient-to-r hover:from-pink-100 dark:hover:from-pink-900/50 hover:to-rose-100 dark:hover:to-rose-900/50 hover:text-pink-600',
          ]"
        >
          #{{ tag.name }}
        </NuxtLink>
      </div>
    </div>
  </aside>
</template>
