<!--
  Admin Dashboard Page
  Migrated from Next.js /app/admin/page.tsx to Nuxt 4 / Vue 3.
  Fetches posts, categories, and tags in parallel for an overview dashboard.
-->
<script setup lang="ts">
import type { AdminComment } from "~~/composables/useApi";
import {
	approveAdminComment,
	fetchAdminComments,
	useBlogStats,
	useCategories,
	useTags,
} from "~~/composables/useApi";

definePageMeta({ layout: "admin" });

useHead({ title: "仪表盘 - X-Blog" });

// Fetch all data in parallel. Aggregate card counts come from the exact
// /api/stats endpoint — deriving them from the post list would silently
// undercount once the blog exceeds the backend's limit cap (100), because
// /api/posts enforces limit <= 100 while the old code requested 1000.
const [postsResponse, categoriesResult, tagsResult, commentsResult, statsResult] =
	await Promise.all([
		usePosts({ limit: 100 }),
		useCategories(),
		useTags(),
		fetchAdminComments(undefined, 1, 100),
		useBlogStats(),
	]);

// useFetch resolves to the AsyncData object — the payload is in .data.value,
// and the list payload's items array is what the dashboard consumes
const posts = postsResponse.data.value?.items ?? [];
const categories = categoriesResult.data.value;
const tags = tagsResult.data.value;
const allComments: AdminComment[] = commentsResult.data?.value?.items ?? [];
const blogStats = statsResult.data.value;

const publishedCount = blogStats?.published_posts ?? posts.filter((p) => p.published).length;
const draftCount = (blogStats?.total_posts ?? posts.length) - publishedCount;
const totalViews = blogStats?.total_views ?? posts.reduce((sum, p) => sum + (p.views || 0), 0);
const pendingComments = allComments.filter((c) => !c.is_approved);
const totalComments = allComments.length;
const pendingCommentsCount = blogStats?.pending_comments ?? pendingComments.length;

// Recent 5 published posts sorted by date (newest first)
const recentPosts = posts
	.filter((p) => p.published)
	.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
	.slice(0, 5);

// Top 5 posts by view count
const topPosts = [...posts].sort((a, b) => (b.views || 0) - (a.views || 0));

// Top 5 pending comments (newest first)
const recentPendingComments = pendingComments.slice(0, 5);

// Helper: count published posts per category (matches Next.js CategoryPieChart)
function postsInCategory(catId: number): number {
	return posts.filter((p) => p.category?.id === catId && p.published).length;
}

const approveError = ref<string | null>(null);

async function handleApprove(commentId: number, approved: boolean) {
	try {
		await approveAdminComment(commentId, approved);
		const comment = allComments.find((c) => c.id === commentId);
		if (comment) comment.is_approved = approved;
		approveError.value = null;
	} catch (e) {
		approveError.value = e instanceof Error ? e.message : "操作失败，请重试";
	}
}

const loadedAt = new Date().toLocaleString("zh-CN");

const stats = [
	{
		title: "文章总数",
		value: blogStats?.total_posts ?? posts.length,
		icon: "lucide:file-text",
		color: "text-blue-600",
		bg: "bg-blue-50",
	},
	{
		title: "已发布",
		value: publishedCount,
		icon: "lucide:check-circle",
		color: "text-green-600",
		bg: "bg-green-50",
	},
	{
		title: "草稿",
		value: draftCount,
		icon: "lucide:clock",
		color: "text-yellow-600",
		bg: "bg-yellow-50",
	},
	{
		title: "分类",
		value: categories?.length || 0,
		icon: "lucide:folder",
		color: "text-purple-600",
		bg: "bg-purple-50",
	},
	{
		title: "标签",
		value: tags?.length || 0,
		icon: "lucide:tag",
		color: "text-pink-600",
		bg: "bg-pink-50",
	},
	{
		title: "待审核评论",
		value: pendingCommentsCount,
		icon: "lucide:message-square",
		color: "text-red-600",
		bg: "bg-red-50",
	},
	{
		title: "总浏览量",
		value: totalViews,
		icon: "lucide:eye",
		color: "text-orange-600",
		bg: "bg-orange-50",
	},
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

    <!-- Recent posts + Pending comments -->
    <div class="grid gap-6 lg:grid-cols-2 mb-8">
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

      <!-- Pending comments -->
      <div class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
          <Icon icon="lucide:message-square" class="w-5 h-5 text-red-500" />
          待审核评论
          <span v-if="pendingComments.length > 0" class="ml-auto text-sm font-normal text-gray-500">
            {{ pendingComments.length }} 条待审核
          </span>
        </h3>
        <div
          v-if="approveError"
          class="mb-4 px-4 py-3 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-600 dark:text-red-400"
        >
          {{ approveError }}
        </div>
        <div v-if="recentPendingComments.length === 0" class="text-gray-500 dark:text-gray-400 text-sm">
          暂无待审核评论
        </div>
        <div v-else class="space-y-3">
          <div
            v-for="comment in recentPendingComments"
            :key="comment.id"
            class="p-3 rounded-xl bg-red-50/50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/20"
          >
            <div class="flex items-start justify-between mb-2">
              <div class="text-sm">
                <span class="font-medium text-gray-900 dark:text-gray-100">{{ comment.nickname }}</span>
                <span class="text-gray-400 mx-1">·</span>
                <NuxtLink :to="`/admin/comments`" class="text-blue-500 hover:text-blue-600">
                  {{ comment.post_title }}
                </NuxtLink>
              </div>
            </div>
            <p class="text-sm text-gray-600 dark:text-gray-400 mb-2 line-clamp-2">
              {{ comment.content }}
            </p>
            <div class="flex items-center gap-2">
              <button
                class="px-3 py-1 text-xs font-medium text-green-700 bg-green-100 dark:bg-green-900/30 dark:text-green-400 rounded-lg hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
                @click="handleApprove(comment.id, true)"
              >
                通过
              </button>
              <button
                class="px-3 py-1 text-xs font-medium text-red-700 bg-red-100 dark:bg-red-900/30 dark:text-red-400 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                @click="handleApprove(comment.id, false)"
              >
                拒绝
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Data freshness -->
    <div class="text-xs text-gray-400 dark:text-gray-600 text-right">
      数据更新于 {{ loadedAt }}
    </div>
  </div>
</template>
