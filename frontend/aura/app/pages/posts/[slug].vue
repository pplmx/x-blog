<script setup lang="ts">
import { computed } from "vue";
import { usePost, usePostView, usePostLike } from "~/composables/useApi";
import { extractToc } from "../../../composables/useToc.ts";

const route = useRoute();
const { data: post, pending, error } = await usePost(route.params.slug as string);

// Extract table of contents from post content
const toc = computed(() => (post.value?.content ? extractToc(post.value.content) : []));

// Fetch related posts only when the post has been loaded with a valid ID.
// Previously this used `post.value?.id || 0` which sent a meaningless request
// to /api/posts/0/related during SSR when the post was still pending or not found.
const postId = post.value?.id ?? 0;
const { data: relatedPosts } = postId ? await useRelatedPosts(postId) : { data: ref(null) };

// Track view count when post is loaded
if (post.value?.id) {
	await usePostView(post.value.id);
}

// SEO: set dynamic head metadata when the post is available
if (post.value) {
	usePostSeo(post.value);
}

// Like handler: toggle like on the current post
const likeLoading = ref(false);
const likeError = ref<string | null>(null);
async function handleLike() {
	if (!post.value?.id || likeLoading.value) return;
	likeLoading.value = true;
	likeError.value = null;
	try {
		await usePostLike(post.value.id);
		// Force refresh the post data to reflect updated like count
		await usePost(route.params.slug as string);
	} catch (err) {
		likeError.value = "Failed to like post. Please try again.";
		console.error("Failed to like post:", err);
	} finally {
		likeLoading.value = false;
	}
}

// Reading progress: track scroll position and update progress bar
const scrollProgress = ref(0);
onMounted(() => {
	const updateProgress = () => {
		const scrolled = window.scrollY;
		const maxScroll = document.body.scrollHeight - window.innerHeight;
		scrollProgress.value = maxScroll > 0 ? (scrolled / maxScroll) * 100 : 0;
	};
	window.addEventListener("scroll", updateProgress);
	updateProgress();
	onUnmounted(() => window.removeEventListener("scroll", updateProgress));
});

// Smooth scroll to heading element
function scrollToHeading(event: MouseEvent) {
	const href = (event.currentTarget as HTMLAnchorElement)?.getAttribute("href");
	if (!href?.startsWith("#")) return;
	const id = href.slice(1);
	const el = document.getElementById(id);
	if (el) {
		el.scrollIntoView({ behavior: "smooth", block: "start" });
	}
}
</script>

<template>
  <div class="max-w-3xl mx-auto">
    <!-- Reading progress bar -->
    <div class="fixed top-0 left-0 right-0 h-1 bg-gray-200 dark:bg-gray-700 z-20">
      <div
        class="h-full bg-blue-600 transition-all duration-150 ease-out"
        :style="{ width: scrollProgress + '%' }"
      />
    </div>

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
      <div class="bg-gray-100 animate-pulse h-8 rounded-lg w-3/4" />
      <div class="bg-gray-100 animate-pulse h-64 rounded-lg" />
      <div class="bg-gray-100 animate-pulse h-4 rounded-lg" />
      <div class="bg-gray-100 animate-pulse h-4 rounded-lg" />
      <div class="bg-gray-100 animate-pulse h-4 rounded-lg w-5/6" />
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
    <div v-else class="flex gap-8">
      <!-- TOC sidebar (desktop only) -->
      <nav
        v-if="toc.length > 1"
        class="hidden lg:block w-64 flex-shrink-0"
      >
        <div class="sticky top-24">
          <div class="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 border border-gray-100 dark:border-gray-800">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
              <Icon icon="lucide:list" class="w-4 h-4" />
              目录
            </h3>
            <ul class="space-y-1">
              <li
                v-for="item in toc"
                :key="item.id"
                :class="[
                  'text-sm transition-colors',
                  item.level === 1 ? 'ml-0' : 'ml-' + (item.level - 1) * 2,
                  'hover:text-blue-600',
                ]"
              >
                <a
                  :href="`#${item.id}`"
                  class="block py-1 text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
                  @click.prevent="scrollToHeading"
                >
                  {{ item.text }}
                </a>
              </li>
            </ul>
          </div>
        </div>
      </nav>

      <!-- Main content -->
      <article class="prose prose-lg max-w-none">
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

        <!-- Cover image -->
        <div
          v-if="post.cover_image"
          class="relative w-full h-[240px] sm:h-[320px] rounded-2xl overflow-hidden mb-8 shadow-xl"
        >
          <img
            :src="post.cover_image"
            :alt="post.title"
            class="w-full h-full object-cover"
          >
        </div>

        <!-- Markdown content -->
        <div v-if="post.content" class="mt-8">
          <MarkdownContent :content="post.content" />
        </div>

        <!-- Bookmark button -->
        <div v-if="post" class="mt-8 pt-6 border-t border-gray-200 flex items-center gap-4">
          <BookmarkButton
            :post-id="post.id"
            :post="post"
            variant="full"
          />
        </div>

        <!-- Like button -->
        <div class="mt-8 pt-6 border-t border-gray-200 flex items-center gap-4">
          <button
            type="button"
            @click="handleLike"
            :disabled="likeLoading"
            class="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-pink-500 to-red-500 text-white rounded-xl font-medium hover:from-pink-600 hover:to-red-600 transition-all shadow-md disabled:opacity-50"
          >
            <Icon
              :icon="likeLoading ? 'lucide:loader-2' : 'lucide:heart'"
              class="w-4 h-4"
            />
            {{ likeLoading ? '点赞中...' : '喜欢' }}
          </button>
          <span class="text-sm text-gray-500" v-if="post.likes">
            {{ post.likes }} 次喜欢
          </span>
          <span v-if="likeError" class="text-sm text-red-500">
            {{ likeError }}
          </span>
        </div>

        <!-- Share buttons -->
        <ShareButtons :title="post.title" v-if="post.title" />

        <!-- Comments -->
        <section v-if="post.id" class="mt-12 pt-8 border-t border-gray-200">
          <CommentList :post-id="post.id" />
          <div class="mt-8 pt-8 border-t border-gray-100">
            <CommentForm :post-id="post.id" />
          </div>
        </section>

        <!-- Related Posts -->
        <section v-if="post.id && relatedPosts?.length" class="mt-12">
          <h2 class="text-xl font-bold mb-6 text-gray-900 dark:text-gray-100">
            相关文章
          </h2>
          <div class="space-y-4">
            <div
              v-for="relatedPost in relatedPosts"
              :key="relatedPost.id"
              class="border border-gray-100 rounded-lg p-4 hover:shadow-md transition-shadow"
            >
              <NuxtLink
                :to="`/posts/${relatedPost.slug}`"
                class="text-lg font-bold hover:text-blue-600"
              >
                {{ relatedPost.title }}
              </NuxtLink>
              <p
                v-if="relatedPost.excerpt"
                class="text-gray-600 mt-1 text-sm line-clamp-2"
              >
                {{ relatedPost.excerpt }}
              </p>
            </div>
          </div>
        </section>

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
