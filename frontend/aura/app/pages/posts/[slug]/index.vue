<script setup lang="ts">
import { computed, nextTick, ref, watch, watchEffect } from "vue";
import {
	likePost,
	recordPostView,
	useAdjacentPosts,
	usePost,
	useRelatedPosts,
} from "~~/api/public/posts";
import { useSeriesBySlug } from "~~/api/public/series";
import { recordReaderHistory } from "~~/api/reader/history";
// biome-ignore lint/correctness/noUnusedImports: used from the template — biome cannot resolve Vue script-setup template bindings (vue-tsc verifies).
import { parseApiDate } from "~~/composables/apiDate";
import { coverImageSrc } from "~~/composables/useCoverImage";
import { markdownToHtml } from "~~/composables/useMarkdown";
import { useReaderAuth } from "~~/composables/useReaderAuth";
import { readingMinutes } from "~~/composables/useReadingTime";
import { useRecentlyViewed } from "~~/composables/useRecentlyViewed";
import { useResumeReading } from "~~/composables/useResumeReading";
import { usePostSeo } from "~~/composables/useSeo";
import { extractToc } from "~~/composables/useToc";

const { t, locale } = useLang();
const route = useRoute();
// Pass a reactive getter (not a static string) so useFetch refetches when the
// slug changes via SPA navigation between posts (TASK-090, ISS-073).
const {
	data: post,
	pending,
	error,
	refresh: refreshPost,
} = await usePost(() => route.params.slug as string);

// A failed load/page-miss must not dead-end a reader arriving via a share
// link — offer Retry and a way back home.
function retryLoad() {
	void refreshPost();
}

// Move keyboard/SR focus to the h1 when SPA navigation swaps the post, so the
// reader lands in the new article (not silently dumped to <body>).
const postTitleEl = ref<HTMLHeadingElement | null>(null);
function focusPostTitle() {
	nextTick(() => {
		postTitleEl.value?.focus({ preventScroll: true });
	});
}

// Continue-reading trail (DEC-104, TASK-164): remember this post client-side
// when its detail page loads (dedup/cap/prune live in useRecentlyViewed).
const { record } = useRecentlyViewed();
const { isAuthenticated } = useReaderAuth();
watch(
	() => (post.value ? { slug: post.value.slug, title: post.value.title } : null),
	(p) => {
		if (p) record(p);
	},
	{ immediate: true },
);

// Extract TOC from the RENDERED markdown HTML — not the raw markdown. The
// post content is Markdown (`# Heading`), but extractToc only recognises HTML
// `<h1>` tags; feeding it raw Markdown always yielded an empty TOC on real
// posts (tests masked this by mocking content as HTML). markdownToHtml uses
// the same heading renderer/MarkdownContent uses, so the emitted ids match
// what extractToc computes (RIL TASK-104, ISS-084).
const toc = computed(() =>
	post.value?.content ? extractToc(markdownToHtml(post.value.content)) : [],
);

// Display cover image: use algorithmic SVG data URI (no HTTP request, consistent style)
// For OpenGraph og:image, usePostSeo uses buildCoverImageUrl (URL for social crawlers)
const coverImageUrl = computed(() => {
	if (!post.value) return "";
	return coverImageSrc(post.value.title);
});

// Derive the id reactively so related/adjacent follow the post when the slug
// changes via SPA navigation (TASK-090, ISS-073).
const postId = computed(() => post.value?.id);
const { data: relatedPosts } = await useRelatedPosts(() => postId.value);
const { data: adjacent } = await useAdjacentPosts(() => postId.value);

// In-series navigation (DEC-056): when this post belongs to a series, load the
// series' ordered posts and locate this post so we can render a series chip and
// next/previous-in-series links. The getter returns null when the post has no
// series, which makes useFetch skip the request entirely.
const { data: seriesDetail } = await useSeriesBySlug(() => post.value?.series?.slug ?? null);
const seriesNav = computed(() => {
	if (!post.value?.series || !seriesDetail.value?.posts) return null;
	const idx = seriesDetail.value.posts.findIndex((p) => p.id === post.value?.id);
	if (idx === -1) return null;
	return {
		series: post.value.series,
		position: idx + 1,
		total: seriesDetail.value.posts.length,
		previous: idx > 0 ? seriesDetail.value.posts[idx - 1] : null,
		next: idx < seriesDetail.value.posts.length - 1 ? seriesDetail.value.posts[idx + 1] : null,
	};
});

// Apply post SEO; re-run when the post changes via SPA navigation so the
// title/og:image/canonical/JSON-LD follow the new slug (TASK-090, ISS-073).
watchEffect(() => {
	if (post.value) {
		usePostSeo(post.value);
	}
});

const likeLoading = ref(false);
const likeError = ref<string | null>(null);
// Client-side "liked this post" dedup (RIL ISS-038): a visitor can like at most
// once per post. isLiked drives the persisted button state; recordLike marks
// before the API call so later clicks are no-ops.
const { isLiked, recordLike, undoLike, persist } = useLikes();
const likedThisPost = computed(() => (post.value?.id ? isLiked(post.value.id) : false));
async function handleLike() {
	if (!post.value?.id || likeLoading.value) return;
	if (likedThisPost.value) return; // already liked — no-op
	likeLoading.value = true;
	likeError.value = null;
	recordLike(post.value.id); // optimistic local marker
	persist();
	try {
		const liked = await likePost(post.value.id);
		// POST /like returns the updated Post (response_model=schemas.Post); use
		// it to refresh the rendered count instead of a discarded refetch, which
		// left post.value.likes stale in the UI.
		if (liked) {
			post.value = liked;
		} else {
			await usePost(route.params.slug as string);
		}
	} catch (_err) {
		likeError.value = t("post.likeError");
		// Roll the optimistic "liked" marker back so a failed like doesn't leave
		// the button permanently disabled & pre-filled (TASK-234). The marker
		// was persisted before the request; undo + persist restores the prior
		// local state and lets the reader retry.
		undoLike(post.value.id);
		persist();
	} finally {
		likeLoading.value = false;
	}
}

const scrollProgress = ref(0);
const activeTocId = ref("");
// Re-created per post so SPA navigation between posts re-observes the new
// article's headings (TASK-231-era deep-dive finding): the old single-shot
// onMounted observer stayed pinned to the first post's headings and the TOC
// highlight froze on SPA nav.
let tocObserver: IntersectionObserver | null = null;
function setupTocObserver() {
	tocObserver?.disconnect();
	activeTocId.value = "";
	tocObserver = new IntersectionObserver(
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
	// Headings render with the content; a short settle lets the new post's
	// article fully replace the previous one before we query for them.
	setTimeout(() => {
		document.querySelectorAll("h1[id], h2[id], h3[id]").forEach((el) => {
			tocObserver?.observe(el);
		});
	}, 500);
}
// Per-post resume reading (DEC-167, TASK-200): restore a signed-in reader's
// saved scroll offset when the post opens, and save it (debounced) while they
// scroll. Only active client-side for authenticated readers (the server trail
// is reader-only); guests are unaffected.
const resume = useResumeReading(() => post.value?.id);
const resumeChipVisible = ref(false);
let resumeChipTimer: ReturnType<typeof setTimeout> | null = null;
// Percentage of the page the restored offset corresponds to, for the chip.
const resumePercent = computed(() => {
	if (typeof window === "undefined" || resume.restoredPosition.value == null) return null;
	const maxScroll = document.body.scrollHeight - window.innerHeight;
	if (maxScroll <= 0) return null;
	const pct = Math.round((resume.restoredPosition.value / maxScroll) * 100);
	return Math.min(99, Math.max(1, pct));
});

function showResumeChip() {
	if (resumeChipTimer) clearTimeout(resumeChipTimer);
	resumeChipTimer = setTimeout(() => {
		resumeChipVisible.value = false;
	}, 8000);
}

/** Client-only per-post session: count the view, sync reading history, and
 * restore/save the signed-in reader's resume position. */
function beginReadingSession(postId: number) {
	recordPostView(postId).catch(() => {});
	if (isAuthenticated.value) {
		recordReaderHistory(postId).catch(() => {});
		// Drop the reader back where they left off, surfacing a small chip so
		// the jump is not unexplained.
		resume.restore().then((pos) => {
			if (pos != null) {
				resumeChipVisible.value = true;
				showResumeChip();
			}
		});
	}
}

// SPA navigation between posts (prev/next, related, TOC) reuses this component
// instance, so onMounted never re-fires for the new post. Watch the loaded id:
// reset the previous post's resume state (stale chip included) and start a
// fresh session. The initial load (oldId undefined) is still handled once by
// onMounted so the view is not double-counted.
watch(postId, (newId, oldId) => {
	if (oldId === undefined || newId === oldId) return;
	resumeChipVisible.value = false;
	resume.reset();
	if (newId) {
		beginReadingSession(newId);
		// Re-observe the new post's headings so the TOC highlight tracks it
		// instead of staying pinned to the previous article.
		setupTocObserver();
		// Announce the new article to keyboard/SR users (the previous post's
		// focused element was torn down with the swap).
		focusPostTitle();
	}
});

onMounted(() => {
	// Client-only view counter: reflects real human reads, not crawlers/bots
	// or SSR pre-renders (running this in top-level setup inflated counts on
	// every server render and search-engine visit). SPA navigations to a
	// different post are handled by the postId watcher above.
	const postId = post.value?.id;
	if (postId) {
		beginReadingSession(postId);
	}
	const updateProgress = () => {
		const scrolled = window.scrollY;
		const maxScroll = document.body.scrollHeight - window.innerHeight;
		scrollProgress.value = maxScroll > 0 ? (scrolled / maxScroll) * 100 : 0;
		// Best-effort, debounced in the composable; no-ops for guests.
		resume.save(scrolled);
	};
	window.addEventListener("scroll", updateProgress);
	updateProgress();
	setupTocObserver();
	onUnmounted(() => {
		window.removeEventListener("scroll", updateProgress);
		tocObserver?.disconnect();
		if (resumeChipTimer) {
			clearTimeout(resumeChipTimer);
			resumeChipTimer = null;
		}
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

// Reading time (shared with the print/PDF view so they agree). The CJK-aware
// logic lives in composables/useReadingTime to keep the detail page and the
// print route consistent with backend crud.reading_minutes (RIL round 72).
const readingTime = computed(() => readingMinutes(post.value?.content));

// Refresh the comment list after the standalone top-level form submits, so the
// new comment + count are visible without a reload (ISS-126).
const commentListRef = ref<{ refreshList: () => Promise<void> } | null>(null);
function handleCommentSubmitted() {
	void commentListRef.value?.refreshList();
}
</script>

<template>
  <div class="max-w-7xl mx-auto">
    <!-- Reading progress bar -->
    <div class="fixed top-0 left-0 right-0 z-50 h-1 bg-gray-100 dark:bg-gray-800">
      <div
        class="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 transition-all duration-150 ease-out"
        :style="{ width: scrollProgress + '%' }"
      />
    </div>

    <!-- Resume-reading chip (DEC-167, TASK-200): shown briefly when the page
         jumped the reader back to their saved position; lets them return to
         the top in one click and then fades. -->
    <transition name="fade">
      <div
        v-if="resumeChipVisible && resumePercent != null"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg px-4 py-2 text-sm text-gray-700 dark:text-gray-200"
        role="status"
      >
        <Icon icon="lucide:bookmark" class="w-4 h-4 text-blue-500" />
        <span>{{ t('post.resumeReading', { percent: resumePercent }) }}</span>
        <button
          class="text-blue-600 dark:text-blue-400 font-medium hover:underline shrink-0"
          data-testid="resume-back-to-top"
          @click="resume.jumpToTop(); resumeChipVisible = false"
        >
          {{ t('post.backToTop') }}
        </button>
      </div>
    </transition>

    <!-- In-place refetch bar: SPA navigation to the prev/next post keeps the
         current article mounted (reading continuity — no full-page pulse) while
         the new post loads; the article below swaps when it resolves. -->
    <div v-if="pending && post" class="fixed top-1 left-0 right-0 z-40 h-0.5 overflow-hidden">
      <div class="h-full w-full bg-blue-500/60 animate-pulse" />
    </div>

    <!-- Loading skeleton: only the very first load, when no content exists yet. -->
    <div v-if="pending && !post" class="max-w-4xl mx-auto space-y-6 pt-8">
      <div class="h-8 bg-gray-200 dark:bg-gray-800 rounded-lg w-3/4 animate-pulse" />
      <div class="h-64 bg-gray-200 dark:bg-gray-800 rounded-2xl animate-pulse" />
      <div class="space-y-3">
        <div class="h-4 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
        <div class="h-4 bg-gray-200 dark:bg-gray-800 rounded w-5/6 animate-pulse" />
        <div class="h-4 bg-gray-200 dark:bg-gray-800 rounded w-4/6 animate-pulse" />
      </div>
    </div>

    <!-- Load error (or a failed refetch to a new slug): give the reader a way
         onward instead of a dead end (they often arrive via a share link). -->
    <div v-else-if="error" class="text-center py-20 text-gray-500">
      <Icon icon="lucide:alert-circle" class="w-12 h-12 mx-auto mb-4 text-gray-300" />
      <p class="mb-4">{{ t('common.state.loadFailed') }}</p>
      <div class="flex items-center justify-center gap-3">
        <button
          type="button"
          class="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          @click="retryLoad"
        >
          {{ t('common.action.retry') }}
        </button>
        <NuxtLink to="/" class="px-4 py-2 rounded-lg text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline">
          {{ t('common.action.backHome') }}
        </NuxtLink>
      </div>
    </div>

    <!-- Not found: a path back home instead of a bare dead end. -->
    <div v-else-if="!post" class="text-center py-20 text-gray-500">
      <Icon icon="lucide:file-question" class="w-12 h-12 mx-auto mb-4 text-gray-300" />
      <p class="mb-4">{{ t('post.notFound') }}</p>
      <NuxtLink to="/" class="px-4 py-2 rounded-lg text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline">
        {{ t('common.action.backHome') }}
      </NuxtLink>
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
      <article class="flex-1 min-w-0 max-w-4xl">
        <!-- Header -->
        <header class="mb-10">
          <NuxtLink to="/" class="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-blue-500 transition-colors mb-6">
            <Icon icon="lucide:arrow-left" class="w-3.5 h-3.5" />
            {{ t('common.action.backHome') }}
          </NuxtLink>

          <!-- Category badge + meta -->
          <div class="flex flex-wrap items-center gap-3 mb-4">
            <NuxtLink
              v-if="post.category"
              :to="{ path: '/', query: { category_id: String(post.category.id) } }"
              class="inline-flex items-center gap-1 px-3 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full text-xs font-medium hover:bg-blue-100 dark:hover:bg-blue-800/40 transition-colors"
            >
              <Icon icon="lucide:folder" class="w-3 h-3" />
              {{ post.category.name }}
            </NuxtLink>
            <NuxtLink
              v-if="post.series"
              :to="`/series/${post.series.slug}`"
              class="inline-flex items-center gap-1 px-3 py-1 bg-gradient-to-r from-indigo-50 dark:from-indigo-900/30 to-purple-50 dark:to-purple-900/30 text-indigo-600 dark:text-indigo-400 rounded-full text-xs font-medium hover:from-indigo-100 dark:hover:from-indigo-900/50 hover:to-purple-100 dark:hover:to-purple-900/50 transition-colors"
            >
              <Icon icon="lucide:layers" class="w-3 h-3" />
              <span v-if="seriesNav">{{ t('series.partLabel', { position: seriesNav.position, count: seriesNav.total }) }}</span>
              <span v-else>{{ post.series.title }}</span>
            </NuxtLink>
            <span class="text-xs text-gray-400 flex items-center gap-1">
              <Icon icon="lucide:clock" class="w-3 h-3" />
              {{ t('post.readingTime', { count: readingTime }) }}
            </span>
            <span class="text-xs text-gray-400 flex items-center gap-1">
              <Icon icon="lucide:eye" class="w-3 h-3" />
              {{ t('post.views', { count: post.views }) }}
            </span>

            <!-- Print / PDF view (DEC-112, TASK-168): SEO-consistent link to the
                 print-friendly route; the print button itself calls window.print(). -->
            <NuxtLink
              :to="`/posts/${post.slug}/print`"
              class="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-blue-500 transition-colors"
              :aria-label="t('post.printPdf')"
            >
              <Icon icon="lucide:printer" class="w-3.5 h-3.5" />
              {{ t('post.printPdf') }}
            </NuxtLink>
          </div>

          <h1
            ref="postTitleEl"
            tabindex="-1"
            class="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 dark:text-gray-100 leading-tight mb-6 text-balance focus:outline-none"
          >
            {{ post.title }}
          </h1>

          <div class="flex items-center gap-4 text-sm text-gray-400">
            <span class="flex items-center gap-1.5">
              <Icon icon="lucide:calendar" class="w-3.5 h-3.5" />
              {{ parseApiDate(post.publish_at ?? post.created_at)?.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", { year: 'numeric', month: 'long', day: 'numeric' }) ?? "" }}
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

        <!-- Tags (each chip is followable in place for signed-in readers, DEC-196/TASK-216) -->
        <footer v-if="post.tags?.length" class="mt-10 pt-8 border-t border-gray-100 dark:border-gray-800">
          <div class="flex flex-wrap gap-2">
            <span
              v-for="tag in post.tags"
              :key="tag.id"
              class="inline-flex items-center bg-gray-100 dark:bg-gray-800 rounded-full text-xs font-medium"
            >
              <NuxtLink
                :to="{ path: '/', query: { tag_id: String(tag.id) } }"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 text-gray-600 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-blue-600 dark:hover:text-blue-400 rounded-full transition-colors"
              >
                <Icon icon="lucide:tag" class="w-3 h-3" />
                {{ tag.name }}
              </NuxtLink>
              <TagFollowButton :tag-id="tag.id" :tag-name="tag.name" />
            </span>
          </div>
        </footer>

        <!-- Actions -->
        <div class="mt-10 pt-8 border-t border-gray-100 dark:border-gray-800 flex flex-wrap items-center gap-4">
          <BookmarkButton :post-id="post.id" :post="post" variant="full" />
          <span class="w-px h-6 bg-gray-200 dark:bg-gray-700" />
          <button type="button" :disabled="likeLoading || likedThisPost" :title="likedThisPost ? t('post.liked') : t('post.likes')" :aria-pressed="likedThisPost ? 'true' : 'false'" :aria-label="likedThisPost ? t('post.liked') : t('post.likes')" class="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 border disabled:opacity-60 disabled:cursor-not-allowed" :class="likedThisPost ? 'border-pink-200 dark:border-pink-800 bg-pink-50 dark:bg-pink-900/20 text-pink-600 dark:text-pink-400' : 'border-gray-200 dark:border-gray-700 hover:bg-pink-50 dark:hover:bg-pink-900/20 hover:text-pink-600 dark:hover:text-pink-400 hover:border-pink-200 dark:hover:border-pink-800 active:scale-95'" @click="handleLike">
            <Icon :icon="likeLoading ? 'lucide:loader-2' : 'lucide:heart'" class="w-4 h-4" :class="{ 'animate-spin': likeLoading }" />
            {{ (post.likes ?? 0).toLocaleString() }}
          </button>
          <span v-if="likeError" role="alert" class="text-sm text-red-500">{{ likeError }}</span>
        </div>

        <!-- Share -->
        <div class="mt-6">
          <ShareButtons :title="post.title" />
        </div>

        <!-- Comments: keyed by post id so SPA navigation (prev/next, related,
             TOC) between posts remounts the thread — useComments builds its path
             once at setup, so a reused instance would keep showing the previous
             article's comments (deep-dive finding). -->
        <section v-if="post.id" class="mt-12 pt-8 border-t border-gray-100 dark:border-gray-800">
          <CommentList :key="post.id" ref="commentListRef" :post-id="post.id" />
          <div class="mt-10 pt-8 border-t border-gray-100 dark:border-gray-800">
            <CommentForm :key="post.id" :post-id="post.id" @submitted="handleCommentSubmitted" />
          </div>
        </section>

        <!-- Related Posts -->
        <section v-if="relatedPosts?.length" class="mt-12 pt-8 border-t border-gray-100 dark:border-gray-800">
          <h2 class="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6 flex items-center gap-2">
            <Icon icon="lucide:file-text" class="w-5 h-5 text-blue-500" />
            {{ t('post.related') }}
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
                <span>{{ t('post.views', { count: rp.views }) }}</span>
              </div>
            </NuxtLink>
          </div>
        </section>

        <!-- Prev / Next linear navigation (public feed order) -->
        <nav
          v-if="adjacent?.previous || adjacent?.next"
          class="mt-12 pt-8 border-t border-gray-100 dark:border-gray-800 grid gap-4 sm:grid-cols-2"
          :aria-label="t('post.navigation')"
        >
          <NuxtLink
            v-if="adjacent?.previous"
            :to="`/posts/${adjacent.previous.slug}`"
            class="group p-5 rounded-2xl border border-gray-100 dark:border-gray-800 hover:border-blue-200 dark:hover:border-blue-800 hover:shadow-lg transition-all duration-200"
          >
            <span class="inline-flex items-center gap-1.5 text-xs text-gray-400 group-hover:text-blue-500 transition-colors">
              <Icon icon="lucide:arrow-left" class="w-3.5 h-3.5" />
              {{ t('post.previousPost') }}
            </span>
            <h3 class="mt-2 font-semibold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-2">
              {{ adjacent.previous.title }}
            </h3>
          </NuxtLink>

          <NuxtLink
            v-if="adjacent?.next"
            :to="`/posts/${adjacent.next.slug}`"
            class="group p-5 rounded-2xl border border-gray-100 dark:border-gray-800 hover:border-blue-200 dark:hover:border-blue-800 hover:shadow-lg transition-all duration-200 sm:text-right"
          >
            <span class="inline-flex items-center gap-1.5 text-xs text-gray-400 group-hover:text-blue-500 transition-colors sm:flex-row-reverse">
              {{ t('post.nextPost') }}
              <Icon icon="lucide:arrow-right" class="w-3.5 h-3.5" />
            </span>
            <h3 class="mt-2 font-semibold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-2">
              {{ adjacent.next.title }}
            </h3>
          </NuxtLink>
        </nav>

        <!-- In-series navigation (DEC-056): prev/next within the series order,
             shown only when the post belongs to a series with a resolved position. -->
        <nav
          v-if="seriesNav"
          class="mt-12 pt-8 border-t border-gray-100 dark:border-gray-800"
          :aria-label="t('series.serialLabel')"
        >
          <div class="flex items-center justify-between gap-4 mb-4">
            <NuxtLink
              :to="`/series/${seriesNav.series.slug}`"
              class="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
            >
              <Icon icon="lucide:layers" class="w-4 h-4" />
              <span>{{ t('series.serialLabel') }} — {{ seriesNav.series.title }}</span>
            </NuxtLink>
            <span class="text-xs text-gray-400 shrink-0">
              {{ t('series.partLabel', { position: seriesNav.position, count: seriesNav.total }) }}
            </span>
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <NuxtLink
              v-if="seriesNav.previous"
              :to="`/posts/${seriesNav.previous.slug}`"
              class="group p-5 rounded-2xl border border-gray-100 dark:border-gray-800 hover:border-indigo-200 dark:hover:border-indigo-800 hover:shadow-lg transition-all duration-200"
            >
              <span class="inline-flex items-center gap-1.5 text-xs text-gray-400 group-hover:text-indigo-500 transition-colors">
                <Icon icon="lucide:arrow-left" class="w-3.5 h-3.5" />
                {{ t('series.previousPart') }}
              </span>
              <h3 class="mt-2 font-semibold text-gray-900 dark:text-gray-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors line-clamp-2">
                {{ seriesNav.previous.title }}
              </h3>
            </NuxtLink>
            <NuxtLink
              v-if="seriesNav.next"
              :to="`/posts/${seriesNav.next.slug}`"
              class="group p-5 rounded-2xl border border-gray-100 dark:border-gray-800 hover:border-indigo-200 dark:hover:border-indigo-800 hover:shadow-lg transition-all duration-200 sm:text-right"
            >
              <span class="inline-flex items-center gap-1.5 text-xs text-gray-400 group-hover:text-indigo-500 transition-colors sm:flex-row-reverse">
                {{ t('series.nextPart') }}
                <Icon icon="lucide:arrow-right" class="w-3.5 h-3.5" />
              </span>
              <h3 class="mt-2 font-semibold text-gray-900 dark:text-gray-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors line-clamp-2">
                {{ seriesNav.next.title }}
              </h3>
            </NuxtLink>
          </div>
        </nav>
      </article>
    </div>
  </div>
</template>
