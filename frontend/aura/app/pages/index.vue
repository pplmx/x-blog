<script setup lang="ts">
import { usePopularPosts, usePosts } from "~~/composables/useApi";
import { useSeo } from "~~/composables/useSeo";

const route = useRoute();
const currentPage = computed(() => Number(route.query.page) || 1);

const {
	data: posts,
	pending,
	error,
} = await usePosts({
	page: currentPage,
	limit: 10,
});

const { data: popularPosts } = await usePopularPosts();

useSeo({
	title: "首页 — X-Blog",
	description: "X-Blog — 一个现代化的技术博客系统。探索最新的技术文章和见解。",
	path: "/",
});

function fetchPosts(pageNum: number) {
	navigateTo({ query: { page: pageNum } });
}

// Hero stats
const stats = computed(() => {
	const items = posts.value?.items ?? [];
	const total = posts.value?.pagination?.total ?? 0;
	const totalViews = items.reduce((s, p) => s + (p.views || 0), 0);
	const totalLikes = items.reduce((s, p) => s + (p.likes || 0), 0);
	return [
		{ label: "文章", value: total },
		{ label: "总阅读", value: totalViews.toLocaleString() },
		{ label: "总点赞", value: totalLikes.toLocaleString() },
	];
});
</script>

<template>
  <div class="max-w-5xl mx-auto">
    <!-- Hero -->
    <section class="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 mb-12 p-8 sm:p-12 lg:p-16">
      <div class="absolute inset-0 opacity-10">
        <div class="absolute top-10 left-10 w-32 h-32 bg-white rounded-full blur-3xl" />
        <div class="absolute bottom-10 right-10 w-48 h-48 bg-white rounded-full blur-3xl" />
        <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-indigo-300 rounded-full blur-3xl" />
      </div>
      <div class="relative z-10">
        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-white/90 text-xs font-medium mb-6 backdrop-blur-sm">
          <Icon icon="lucide:sparkles" class="w-3.5 h-3.5" />
          技术博客
        </div>
        <h1 class="text-3xl sm:text-4xl lg:text-5xl font-bold text-white leading-tight mb-4">
          探索技术的无限可能
        </h1>
        <p class="text-lg text-white/80 max-w-xl mb-8 leading-relaxed">
          X-Blog 是一个基于 FastAPI + Nuxt 4 构建的现代化技术博客系统，分享前端、后端、架构等领域的实践经验。
        </p>
        <div class="flex flex-wrap gap-4">
          <NuxtLink to="/search" class="inline-flex items-center gap-2 px-6 py-3 bg-white text-indigo-700 rounded-xl font-semibold hover:bg-indigo-50 transition-all shadow-lg hover:shadow-xl active:scale-[0.98]">
            <Icon icon="lucide:search" class="w-4 h-4" />
            搜索文章
          </NuxtLink>
          <NuxtLink to="/about" class="inline-flex items-center gap-2 px-6 py-3 bg-white/15 text-white rounded-xl font-medium hover:bg-white/25 transition-all backdrop-blur-sm">
            <Icon icon="lucide:info" class="w-4 h-4" />
            关于本站
          </NuxtLink>
        </div>
        <div class="flex gap-8 mt-8 pt-8 border-t border-white/15">
          <div v-for="stat in stats" :key="stat.label" class="text-center">
            <div class="text-2xl font-bold text-white">{{ stat.value }}</div>
            <div class="text-xs text-white/60 mt-1">{{ stat.label }}</div>
          </div>
        </div>
      </div>
    </section>

    <div class="flex flex-col lg:flex-row gap-8">
      <!-- Main posts -->
      <div class="flex-1 min-w-0">
        <!-- Popular posts highlight -->
        <div v-if="popularPosts?.length" class="mb-10">
          <h2 class="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
            <Icon icon="lucide:trending-up" class="w-5 h-5 text-orange-500" />
            热门文章
          </h2>
          <div class="grid gap-3 sm:grid-cols-2">
            <NuxtLink
              v-for="(post, idx) in popularPosts.slice(0, 4)"
              :key="post.id"
              :to="`/posts/${post.slug}`"
              class="group relative p-4 rounded-xl border border-gray-100 dark:border-gray-800 hover:border-orange-200 dark:hover:border-orange-800 hover:shadow-md transition-all duration-200"
            >
              <div class="flex items-start gap-3">
                <span class="flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-orange-100 dark:from-orange-900/50 to-amber-100 dark:to-amber-900/50 text-orange-600 dark:text-orange-400 text-xs font-bold shrink-0">
                  {{ idx + 1 }}
                </span>
                <div class="min-w-0">
                  <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors line-clamp-2">
                    {{ post.title }}
                  </h3>
                  <p class="text-xs text-gray-400 mt-1">{{ post.views }} 阅读</p>
                </div>
              </div>
            </NuxtLink>
          </div>
        </div>

        <!-- Section heading -->
        <h2 class="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
          <Icon icon="lucide:clock" class="w-5 h-5 text-blue-500" />
          最新文章
        </h2>

        <!-- Loading skeleton -->
        <div v-if="pending" class="space-y-4">
          <div v-for="i in 3" :key="i" class="rounded-2xl border border-gray-100 dark:border-gray-800 p-6 space-y-3">
            <div class="h-5 bg-gray-200 dark:bg-gray-800 rounded w-3/4 animate-pulse" />
            <div class="h-3 bg-gray-200 dark:bg-gray-800 rounded w-1/4 animate-pulse" />
            <div class="h-3 bg-gray-200 dark:bg-gray-800 rounded w-full animate-pulse" />
            <div class="h-3 bg-gray-200 dark:bg-gray-800 rounded w-2/3 animate-pulse" />
          </div>
        </div>

        <div v-else-if="error" class="text-center py-16 text-gray-500">
          <Icon icon="lucide:alert-circle" class="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>加载失败</p>
          <p class="text-sm">{{ error.message }}</p>
        </div>

        <div v-else-if="posts?.items?.length" class="space-y-5">
          <PostCard v-for="post in posts.items" :key="post.id" :post="post" />

          <!-- Pagination -->
          <div v-if="posts.pagination.total_pages > 1" class="flex items-center justify-center gap-2 mt-8">
            <button
              v-for="pg in posts.pagination.total_pages"
              :key="pg"
              :class="[
                'w-9 h-9 rounded-xl text-sm font-medium transition-all duration-200',
                pg === posts.pagination.page
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                  : 'border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800',
              ]"
              @click="fetchPosts(pg)"
            >
              {{ pg }}
            </button>
          </div>
        </div>

        <div v-else class="text-center py-16 text-gray-500">
          <Icon icon="lucide:file-text" class="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>暂无文章</p>
        </div>
      </div>

      <!-- Sidebar -->
      <aside class="lg:w-72 shrink-0">
        <div class="sticky top-24 space-y-6">
          <!-- Stats card -->
          <div class="rounded-2xl bg-gradient-to-br from-blue-50 dark:from-blue-950/50 to-indigo-50 dark:to-indigo-950/50 border border-blue-100 dark:border-blue-900/30 p-5">
            <h3 class="text-sm font-bold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
              <Icon icon="lucide:activity" class="w-4 h-4 text-blue-500" />
              站点统计
            </h3>
            <div class="space-y-3">
              <div v-for="stat in stats" :key="stat.label" class="flex items-center justify-between text-sm">
                <span class="text-gray-500 dark:text-gray-400">{{ stat.label }}</span>
                <span class="font-semibold text-gray-900 dark:text-gray-100">{{ stat.value }}</span>
              </div>
            </div>
          </div>

          <!-- Quick links -->
          <div class="rounded-2xl border border-gray-100 dark:border-gray-800 p-5">
            <h3 class="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
              <Icon icon="lucide:compass" class="w-4 h-4 text-blue-500" />
              快速导航
            </h3>
            <div class="space-y-1">
              <NuxtLink to="/" class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                <Icon icon="lucide:home" class="w-3.5 h-3.5" />首页
              </NuxtLink>
              <NuxtLink to="/about" class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                <Icon icon="lucide:user" class="w-3.5 h-3.5" />关于
              </NuxtLink>
              <NuxtLink to="/search" class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                <Icon icon="lucide:search" class="w-3.5 h-3.5" />搜索
              </NuxtLink>
              <a href="https://github.com/pplmx/x-blog" target="_blank" rel="noopener noreferrer" class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                <Icon icon="lucide:github" class="w-3.5 h-3.5" />GitHub
              </a>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>
