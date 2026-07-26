<script setup lang="ts">
const route = useRoute();
const query = route.query.q || "";

const {
	data: searchResult,
	pending,
	error,
} = await useSearch(query, route.query.page ? Number.parseInt(route.query.page, 10) : 1);

// SEO: set dynamic head metadata based on search query
useHead({
	title: query ? `搜索: ${query}` : "搜索文章",
	meta: [
		{
			name: "description",
			content: query ? `搜索"${query}"的文章结果` : "在 X-Blog 中搜索文章",
		},
		{ name: "robots", content: "noindex, follow" },
	],
});

// Search input handler: navigate to /search?q=keyword on Enter
const searchInput = ref("");
function handleSearchInput() {
	if (searchInput.value.trim()) {
		navigateTo({ query: { q: searchInput.value.trim() } });
	}
}
</script>

<template>
  <div class="max-w-4xl mx-auto">
    <!-- Empty query state -->
    <div
      v-if="!query"
      class="flex flex-col items-center justify-center py-20"
    >
      <div
        class="w-20 h-20 rounded-full bg-gradient-to-br from-gray-100 dark:from-gray-800 to-white dark:to-gray-900 flex items-center justify-center mb-6"
      >
        <Icon icon="lucide:search" class="w-10 h-10 text-gray-400" />
      </div>
      <h2 class="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">
        搜索文章
      </h2>
      <p class="text-gray-500 dark:text-gray-400 mb-6">
        输入关键词开始搜索
      </p>
      <div class="w-full max-w-md">
        <div class="relative">
          <input
            v-model="searchInput"
            type="text"
            placeholder="输入关键词..."
            class="w-full pl-10 pr-4 py-3 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            @keydown.enter="handleSearchInput"
          >
          <Icon
            icon="lucide:search"
            class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
          />
        </div>
      </div>
    </div>

    <!-- Loading state -->
    <div v-else-if="pending" class="space-y-4">
      <div class="bg-gray-100 animate-pulse h-8 rounded-lg mb-4 w-1/3" />
      <div
        v-for="i in 3"
        :key="i"
        class="bg-gray-100 animate-pulse h-24 rounded-lg"
      />
    </div>

    <!-- Error state -->
    <div
      v-else-if="error"
      class="text-center py-12 text-gray-500"
    >
      加载失败: {{ error.message }}
    </div>

    <!-- Search results -->
    <div v-else>
      <!-- Header -->
      <div class="mb-8">
        <h1
          class="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent"
        >
          搜索结果
        </h1>
        <p class="text-gray-500 dark:text-gray-400 mt-2">
          找到 "{{ query }}" 相关文章
          {{ searchResult?.pagination?.total || 0 }} 篇
        </p>
      </div>

      <!-- Empty results -->
      <div
        v-if="!searchResult?.items?.length"
        class="flex flex-col items-center justify-center py-16 bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800"
      >
        <div
          class="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4"
        >
          <Icon icon="lucide:search-x" class="w-8 h-8 text-gray-400" />
        </div>
        <h3 class="text-lg font-medium text-gray-700 dark:text-gray-300 mb-1">
          没有找到相关文章
        </h3>
        <p class="text-sm text-gray-500 dark:text-gray-400">
          试试其他关键词吧
        </p>
      </div>

      <!-- Results list -->
      <div
        v-else
        class="space-y-6"
      >
        <div
          v-for="post in searchResult.items"
          :key="post.id"
          class="border border-gray-100 rounded-lg p-6 hover:shadow-md transition-shadow"
        >
          <NuxtLink
            :to="`/posts/${post.slug}`"
            class="text-xl font-bold hover:text-blue-600"
          >
            {{ post.title }}
          </NuxtLink>
          <p
            v-if="post.excerpt"
            class="text-gray-600 mt-2 line-clamp-2"
          >
            {{ post.excerpt }}
          </p>
          <div class="flex gap-4 mt-3 text-sm text-gray-500">
            <span v-if="post.category">
              {{ post.category.name }}
            </span>
            <span>
              {{ new Date(post.created_at).toLocaleDateString() }}
            </span>
            <span>{{ post.views }} 次阅读</span>
          </div>
        </div>

        <!-- Pagination -->
        <div
          v-if="searchResult.pagination.total_pages > 1"
          class="flex justify-center gap-2 mt-8"
        >
          <button
            v-for="pg in searchResult.pagination.total_pages"
            :key="pg"
            :class="[
              'px-3 py-1 rounded',
              pg === searchResult.pagination.page
                ? 'bg-blue-600 text-white'
                : 'border hover:bg-gray-50',
            ]"
            @click="navigateTo({ query: { q: query, page: pg } })"
          >
            {{ pg }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<route lang="json">
{
  "meta": {
    "title": "搜索",
    "description": "X-Blog - 搜索文章"
  }
}
</route>
