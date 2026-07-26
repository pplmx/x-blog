<script setup lang="ts">
const {
	data: posts,
	pending,
	error,
	refresh,
} = await usePosts({
	page: 1,
	limit: 10,
});

const { data: popularPosts } = await usePopularPosts();

const route = useRoute();

function fetchPosts(pageNum: number) {
	navigateTo({ query: { page: pageNum } });
	refresh();
}

// SEO: set dynamic head metadata
useHead({
	title: "首页 — X-Blog",
	meta: [
		{
			name: "description",
			content: "X-Blog — 一个现代化的技术博客系统。探索最新的技术文章和见解。",
		},
	],
});
</script>

<template>
  <div class="max-w-4xl mx-auto">
    <!-- Hero -->
    <div class="text-center mb-12">
      <h1 class="text-4xl font-bold mb-3">X-Blog</h1>
      <p class="text-gray-500">一个现代化的技术博客系统</p>
    </div>

    <!-- Popular Posts -->
    <div
      v-if="popularPosts?.length"
      class="mb-12"
    >
      <h2 class="text-xl font-bold mb-4 text-gray-900 dark:text-gray-100">
        热门文章
      </h2>
      <div class="space-y-4">
        <div
          v-for="post in popularPosts"
          :key="post.id"
          class="border border-gray-100 rounded-lg p-4 hover:shadow-md transition-shadow"
        >
          <NuxtLink
            :to="`/posts/${post.slug}`"
            class="font-bold hover:text-blue-600"
          >
            {{ post.title }}
          </NuxtLink>
          <div class="flex gap-4 mt-2 text-sm text-gray-500">
            <span v-if="post.category">{{ post.category.name }}</span>
            <span>{{ post.views }} 次阅读</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Posts -->
    <div v-if="pending" class="space-y-4">
      <div v-for="i in 3" :key="i" class="bg-gray-100 animate-pulse h-24 rounded-lg" />
    </div>

    <div v-else-if="error" class="text-center py-12 text-gray-500">
      加载失败: {{ error.message }}
    </div>

    <div v-else-if="posts?.items?.length" class="space-y-6">
      <div
        v-for="post in posts.items"
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
          <span v-if="post.category">{{ post.category.name }}</span>
          <span>{{ new Date(post.created_at).toLocaleDateString() }}</span>
          <span>{{ post.views }} 次阅读</span>
        </div>
      </div>

      <!-- Pagination -->
      <div
        v-if="posts.pagination.total_pages > 1"
        class="flex justify-center gap-2 mt-8"
      >
        <button
          v-for="pg in posts.pagination.total_pages"
          :key="pg"
          :class="[
            'px-3 py-1 rounded',
            pg === posts.pagination.page
              ? 'bg-blue-600 text-white'
              : 'border hover:bg-gray-50',
          ]"
          @click="fetchPosts(pg)"
        >
          {{ pg }}
        </button>
      </div>
    </div>

    <div v-else class="text-center py-12 text-gray-500">
      暂无文章
    </div>
  </div>
</template>
