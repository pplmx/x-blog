<script setup lang="ts">
import { computed } from "vue";
import { usePost, usePostLike, usePostView, useRelatedPosts } from "~~/composables/useApi";
import { coverImageSrc } from "~~/composables/useCoverImage";
import { usePostSeo } from "~~/composables/useSeo";
import { extractToc } from "~~/composables/useToc";

const route = useRoute();
const { data: post, pending, error } = await usePost(route.params.slug as string);

const toc = computed(() => (post.value?.content ? extractToc(post.value.content) : []));

// Display cover image: use algorithmic SVG data URI (no HTTP request, consistent style)
// For OpenGraph og:image, usePostSeo uses buildCoverImageUrl (URL for social crawlers)
const coverImageUrl = computed(() => {
	if (!post.value) return "";
	return coverImageSrc(post.value.title);
});

const postId = post.value?.id ?? 0;
const { data: relatedPosts } = postId ? await useRelatedPosts(postId) : { data: ref(null) };

if (post.value?.id) {
	await usePostView(post.value.id);
}

if (post.value) {
	usePostSeo(post.value);
}

const likeLoading = ref(false);
const likeError = ref<string | null>(null);
async function handleLike() {
	if (!post.value?.id || likeLoading.value) return;
	likeLoading.value = true;
	likeError.value = null;
	try {
		const liked = await usePostLike(post.value.id);
		// POST /like returns the updated Post (response_model=schemas.Post); use
		// it to refresh the rendered count instead of a discarded refetch, which
		// left post.value.likes stale in the UI.
		if (liked.data?.value) {
			post.value = liked.data.value;
		} else {
			await usePost(route.params.slug as string);
		}
	} catch (_err) {
		likeError.value = "Failed to like post. Please try again.";
	} finally {
		likeLoading.value = false;
	}
}

const scrollProgress = ref(0);
const activeTocId = ref("");
onMounted(() => {
	const updateProgress = () => {
		const scrolled = window.scrollY;
		const maxScroll = document.body.scrollHeight - window.innerHeight;
		scrollProgress.value = maxScroll > 0 ? (scrolled / maxScroll) * 100 : 0;
	};
	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					activeTocId.value = entry.target.id;
					break;
				}
			}
		},
		{ rootMargin: "-80px 0px -60% 0px" },
	);
	window.addEventListener("scroll", updateProgress);
	updateProgress();
	setTimeout(() => {
		document.querySelectorAll("h1[id], h2[id], h3[id]").forEach((el) => {
			observer.observe(el);
		});
	}, 500);
	onUnmounted(() => {
		window.removeEventListener("scroll", updateProgress);
		observer.disconnect();
	});
});

function scrollToHeading(event: MouseEvent) {
	const href = (event.currentTarget as HTMLAnchorElement)?.getAttribute("href");
	if (!href?.startsWith("#")) return;
	const id = href.slice(1);
	const el = document.getElementById(id);
	if (el) {
		el.scrollIntoView({ behavior: "smooth", block: "start" });
		history.replaceState(null, "", `#${id}`);
	}
}

const readingTime = computed(() => {
	if (!post.value?.content) return "1 分钟";
	const words = post.value.content.replace(/[#*`\n]/g, " ").split(/\s+/).length;
	const minutes = Math.max(1, Math.round(words / 200));
	return `${minutes} 分钟`;
});
</script>

<template>
  <div class="max-w-4xl mx-auto">
    <!-- Reading progress bar -->
    <div class="fixed top-0 left-0 right-0 z-50 h-1 bg-gray-100 dark:bg-gray-800">
      <div
        class="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 transition-all duration-150 ease-out"
        :style="{ width: scrollProgress + '%' }"
      />
    </div>

    <!-- Loading skeleton -->
    <div v-if="pending" class="max-w-3xl mx-auto space-y-6 pt-8">
      <div class="h-8 bg-gray-200 dark:bg-gray-800 rounded-lg w-3/4 animate-pulse" />
      <div class="h-64 bg-gray-200 dark:bg-gray-800 rounded-2xl animate-pulse" />
      <div class="space-y-3">
        <div class="h-4 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
        <div class="h-4 bg-gray-200 dark:bg-gray-800 rounded w-5/6 animate-pulse" />
        <div class="h-4 bg-gray-200 dark:bg-gray-800 rounded w-4/6 animate-pulse" />
      </div>
    </div>

    <div v-else-if="error" class="text-center py-20 text-gray-500">
      <Icon icon="lucide:alert-circle" class="w-12 h-12 mx-auto mb-4 text-gray-300" />
      <p>加载失败</p>
      <p class="text-sm">{{ error.message }}</p>
    </div>

    <div v-else-if="!post" class="text-center py-20 text-gray-500">
      <Icon icon="lucide:file-question" class="w-12 h-12 mx-auto mb-4 text-gray-300" />
      <p>文章不存在</p>
    </div>

    <div v-else class="flex gap-10 relative">
      <!-- TOC sidebar -->
      <nav
        v-if="toc.length > 1"
        class="hidden xl:block w-64 shrink-0"
      >
        <div class="sticky top-24">
          <div class="border-l-2 border-gray-100 dark:border-gray-800 pl-4 space-y-1">
            <a
              v-for="item in toc"
              :key="item.id"
              :href="`#${item.id}`"
              :class="[
                'block text-sm py-1.5 transition-all duration-200 border-l-2 -ml-[18px] pl-3',
                item.level === 1 ? '' : 'ml-' + (item.level - 1) * 4,
                activeTocId === item.id
                  ? 'text-blue-600 dark:text-blue-400 border-blue-500 font-medium'
                  : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300',
              ]"
              @click.prevent="scrollToHeading"
            >
              {{ item.text }}
            </a>
          </div>
        </div>
      </nav>

      <!-- Main content -->
      <article class="flex-1 min-w-0 max-w-3xl">
        <!-- Header -->
        <header class="mb-10">
          <NuxtLink to="/" class="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-blue-500 transition-colors mb-6">
            <Icon icon="lucide:arrow-left" class="w-3.5 h-3.5" />
            返回首页
          </NuxtLink>

          <!-- Category badge + meta -->
          <div class="flex flex-wrap items-center gap-3 mb-4">
            <span v-if="post.category" class="inline-flex items-center gap-1 px-3 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full text-xs font-medium">
              <Icon icon="lucide:folder" class="w-3 h-3" />
              {{ post.category.name }}
            </span>
            <span class="text-xs text-gray-400 flex items-center gap-1">
              <Icon icon="lucide:clock" class="w-3 h-3" />
              {{ readingTime }}
            </span>
            <span class="text-xs text-gray-400 flex items-center gap-1">
              <Icon icon="lucide:eye" class="w-3 h-3" />
              {{ post.views }} 次阅读
            </span>
          </div>

          <h1 class="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 dark:text-gray-100 leading-tight mb-6 text-balance">
            {{ post.title }}
          </h1>

          <div class="flex items-center gap-4 text-sm text-gray-400">
            <span class="flex items-center gap-1.5">
              <Icon icon="lucide:calendar" class="w-3.5 h-3.5" />
              {{ new Date(post.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) }}
            </span>
          </div>

          <p v-if="post.excerpt" class="mt-6 text-lg text-gray-600 dark:text-gray-400 leading-relaxed border-l-4 border-blue-200 dark:border-blue-800 pl-4 italic">
            {{ post.excerpt }}
          </p>
        </header>

        <!-- Cover image -->
        <div class="relative w-full aspect-[2/1] rounded-2xl overflow-hidden mb-10 shadow-lg">
          <img :src="coverImageUrl" :alt="post.title" class="w-full h-full object-cover" />
          <div class="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent" />
        </div>

        <!-- Markdown content -->
        <div v-if="post.content" class="prose-config">
          <MarkdownContent :content="post.content" />
        </div>

        <!-- Tags -->
        <footer v-if="post.tags?.length" class="mt-10 pt-8 border-t border-gray-100 dark:border-gray-800">
          <div class="flex flex-wrap gap-2">
            <span v-for="tag in post.tags" :key="tag.id" class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-full text-xs font-medium hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-default">
              <Icon icon="lucide:tag" class="w-3 h-3" />
              {{ tag.name }}
            </span>
          </div>
        </footer>

        <!-- Actions -->
        <div class="mt-10 pt-8 border-t border-gray-100 dark:border-gray-800 flex flex-wrap items-center gap-4">
          <BookmarkButton :post-id="post.id" :post="post" variant="full" />
          <span class="w-px h-6 bg-gray-200 dark:bg-gray-700" />
          <button type="button" :disabled="likeLoading" class="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 border border-gray-200 dark:border-gray-700 hover:bg-pink-50 dark:hover:bg-pink-900/20 hover:text-pink-600 dark:hover:text-pink-400 hover:border-pink-200 dark:hover:border-pink-800 active:scale-95" @click="handleLike">
            <Icon :icon="likeLoading ? 'lucide:loader-2' : 'lucide:heart'" class="w-4 h-4" :class="{ 'animate-spin': likeLoading }" />
            {{ post.likes || "喜欢" }}
          </button>
          <span v-if="likeError" class="text-sm text-red-500">{{ likeError }}</span>
        </div>

        <!-- Share -->
        <div class="mt-6">
          <ShareButtons :title="post.title" />
        </div>

        <!-- Comments -->
        <section v-if="post.id" class="mt-12 pt-8 border-t border-gray-100 dark:border-gray-800">
          <CommentList :post-id="post.id" />
          <div class="mt-10 pt-8 border-t border-gray-100 dark:border-gray-800">
            <CommentForm :post-id="post.id" />
          </div>
        </section>

        <!-- Related Posts -->
        <section v-if="relatedPosts?.length" class="mt-12 pt-8 border-t border-gray-100 dark:border-gray-800">
          <h2 class="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6 flex items-center gap-2">
            <Icon icon="lucide:file-text" class="w-5 h-5 text-blue-500" />
            相关文章
          </h2>
          <div class="grid gap-4 sm:grid-cols-2">
            <NuxtLink
              v-for="rp in relatedPosts"
              :key="rp.id"
              :to="`/posts/${rp.slug}`"
              class="group relative p-5 rounded-2xl border border-gray-100 dark:border-gray-800 hover:border-blue-200 dark:hover:border-blue-800 hover:shadow-lg transition-all duration-200"
            >
              <h3 class="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-2">
                {{ rp.title }}
              </h3>
              <p v-if="rp.excerpt" class="text-sm text-gray-500 mt-2 line-clamp-2">
                {{ rp.excerpt }}
              </p>
              <div class="flex items-center gap-3 mt-3 text-xs text-gray-400">
                <span>{{ rp.category?.name }}</span>
                <span>{{ rp.views }} 阅读</span>
              </div>
            </NuxtLink>
          </div>
        </section>
      </article>
    </div>
  </div>
</template>
