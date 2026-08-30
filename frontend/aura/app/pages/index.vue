<script setup lang="ts">
import type { PostList } from "~~/api/contracts/shared";
import { usePopularPosts, usePosts } from "~~/api/public/posts";
import { useBlogStats } from "~~/api/public/stats";
import { useCategories, useTags } from "~~/api/public/taxonomy";
import type { FollowedSeriesItem } from "~~/api/reader/follows";
import { useReaderFollowsFeed, useReaderSeriesFollows } from "~~/api/reader/follows";
import type { SeriesProgress } from "~~/api/reader/history";
import { useReaderRecommendations, useReaderSeriesProgress } from "~~/api/reader/history";
import { paginationPages } from "~~/composables/usePagination";
import { useRecentlyViewed } from "~~/composables/useRecentlyViewed";
import { useSeo } from "~~/composables/useSeo";

const { t } = useLang();
const route = useRoute();

// Plain ref for current page — gives us explicit control over re-fetching.
// Synced from route.query.page on init and when browser back/forward runs.
const page = ref(Number(route.query.page) || 1);

// Category/tag filter refs, driven by the route query. The sitemap and shared
// links use /?category_id=X and /?tag_id=X as deep-link browse URLs, so the
// home feed must honour them (previously ignored → unfiltered feed).
const categoryId = computed(() =>
	route.query.category_id ? Number.parseInt(String(route.query.category_id), 10) : undefined,
);
const tagId = computed(() =>
	route.query.tag_id ? Number.parseInt(String(route.query.tag_id), 10) : undefined,
);

// Build the filter set from the page + filter refs. The reactive getter drives
// useFetch, so a page/category/tag change re-fetches (the type-level comment
// below documents the refetch contract for future maintainers).
const postsFilters = computed(() => ({
	page: page.value,
	limit: 10,
	category_id: categoryId.value,
	tag_id: tagId.value,
}));

// Reset to page 1 when the active category/tag filter changes, so we don't
// land past the end of a newly filtered result set.
watch([categoryId, tagId], () => {
	if (page.value !== 1) page.value = 1;
});

const { data: posts, pending, error } = await usePosts(postsFilters);

const { data: popularPosts } = await usePopularPosts();

// Personalized "Recommended for you" (DEC-128, TASK-176): shown only to
// signed-in readers, sourced from their history/bookmark category+tag affinity.
const recommendedPosts = ref<PostList[]>([]);
const recommending = ref(false);
const recSignedIn = computed(
	() =>
		typeof window !== "undefined" &&
		typeof localStorage?.getItem === "function" &&
		!!localStorage.getItem("reader_token"),
);
onMounted(async () => {
	if (!recSignedIn.value) return;
	recommending.value = true;
	try {
		const res = await useReaderRecommendations(6);
		recommendedPosts.value = res.data?.value ?? [];
	} catch {
		recommendedPosts.value = [];
	} finally {
		recommending.value = false;
	}
	await loadFollowedSeries();
	await loadFollowsFeed();
});

// "Latest from your follows" (DEC-142, TASK-183): newest posts from the
// reader's followed categories + series, gated to signed-in followers.
const followsFeed = ref<PostList[]>([]);
const followsFeedLoading = ref(false);
const followsFeedVisible = computed(() => recSignedIn.value && followsFeed.value.length > 0);

async function loadFollowsFeed() {
	if (!recSignedIn.value) return;
	followsFeedLoading.value = true;
	try {
		const res = await useReaderFollowsFeed(12);
		followsFeed.value = res.data?.value ?? [];
	} catch {
		followsFeed.value = [];
	} finally {
		followsFeedLoading.value = false;
	}
}

// Personalized "Your series" (DEC-136, TASK-180): a signed-in reader who
// follows series sees each one with reading progress (TASK-173) and a
// continue deep link, so they can resume several ongoing series in one place.
const followedSeries = ref<FollowedSeriesItem[]>([]);
const followedProgress = ref<Record<string, SeriesProgress | null>>({});
const followedLoading = ref(false);
const followedVisible = computed(() => recSignedIn.value && followedSeries.value.length > 0);

function seriesProgressPercent(p: SeriesProgress): number {
	if (!p || p.total <= 0) return 0;
	return Math.min(100, Math.round((p.read_count / p.total) * 100));
}

async function loadFollowedSeries() {
	if (!recSignedIn.value) return;
	followedLoading.value = true;
	try {
		const res = await useReaderSeriesFollows();
		const items = res.data?.value?.items ?? [];
		followedSeries.value = items;
		const entries = await Promise.all(
			items.map(async (s) => {
				try {
					const p = await useReaderSeriesProgress(s.slug);
					return [s.slug, p.data?.value ?? null] as const;
				} catch {
					return [s.slug, null] as const;
				}
			}),
		);
		followedProgress.value = Object.fromEntries(entries);
	} catch {
		followedSeries.value = [];
		followedProgress.value = {};
	} finally {
		followedLoading.value = false;
	}
}

// Look up active filter labels for the "filtered by" indicator (deep-link UX).
const { data: categories } = await useCategories();
const { data: tags } = await useTags();
const { data: statsData } = await useBlogStats();
const activeFilterLabel = computed(() => {
	if (categoryId.value && categories.value) {
		const name = categories.value.find((c) => c.id === categoryId.value)?.name;
		if (name) return name;
	}
	if (tagId.value && tags.value) {
		const name = tags.value.find((tg) => tg.id === tagId.value)?.name;
		if (name) return name;
	}
	return undefined;
});
// A deep-link filter is active even when its category/tag no longer resolves
// (deleted since the link was shared): the chip must still render so the
// reader can clear the dead-end filter instead of being stuck on an empty or
// filtered feed with no affordance to leave (surfaced in deep-dive review).
const hasActiveFilter = computed(() => Boolean(categoryId.value || tagId.value));
const filterIndicatorText = computed(() =>
	activeFilterLabel.value
		? t("home.sections.filtered", { label: activeFilterLabel.value })
		: t("home.sections.filteredUnknown"),
);

useSeo({
	title: t("home.seo.title"),
	description: t("home.seo.description"),
	path: "/",
});

// Continue-reading trail (DEC-104, TASK-164): recently opened posts, rendered
// as a compact row on the home page when the visitor has read something.
const { recent: recentPosts } = useRecentlyViewed();

// Windowed, ellipsis-aware pagination buttons (RIL TASK-083, ISS-052): render
// the first, current±window and last page joined by "…" instead of one button
// per page, so large blogs don't overflow the layout.
const paginationTokens = computed(() =>
	paginationPages(posts.value?.pagination?.total_pages ?? 0, posts.value?.pagination?.page ?? 1),
);

function fetchPosts(pageNum: number) {
	// Update page ref first — this triggers useFetch re-fetch via watch
	page.value = pageNum;
	// Then update the URL so the page is bookmarkable (preserve active filters)
	const query: Record<string, string> = { page: String(pageNum) };
	if (categoryId.value) query.category_id = String(categoryId.value);
	if (tagId.value) query.tag_id = String(tagId.value);
	navigateTo({ query });
}

// Sync page ref from URL when browser back / forward changes the route
watch(
	() => route.query.page,
	(newPage) => {
		const p = Number(newPage) || 1;
		if (p !== page.value) {
			page.value = p;
		}
	},
);

// Hero/global stats — sourced from the real /api/stats aggregates (site-wide),
// not the current page's items. Summing the first page's 10 items presented a
// per-page number as a site total and changed with pagination (ISS-035).
const stats = computed(() => {
	const total = statsData.value?.total_posts ?? posts.value?.pagination?.total ?? 0;
	const totalViews = statsData.value?.total_views ?? 0;
	const totalLikes = statsData.value?.total_likes ?? 0;
	const totalComments = statsData.value?.total_comments ?? 0;
	return [
		{ labelKey: "home.stats.posts", value: total.toLocaleString() },
		{ labelKey: "home.stats.totalViews", value: totalViews.toLocaleString() },
		{ labelKey: "home.stats.totalLikes", value: totalLikes.toLocaleString() },
		{ labelKey: "home.stats.totalComments", value: totalComments.toLocaleString() },
	];
});
</script>

<template>
  <div class="max-w-6xl mx-auto">
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
          {{ t("home.hero.badge") }}
        </div>
        <h1 class="text-3xl sm:text-4xl lg:text-5xl font-bold text-white leading-tight mb-4">
          {{ t("home.hero.title") }}
        </h1>
        <p class="text-lg text-white/80 max-w-xl mb-8 leading-relaxed">
          {{ t("home.hero.description") }}
        </p>
        <div class="flex flex-wrap gap-4">
          <NuxtLink to="/search" class="inline-flex items-center gap-2 px-6 py-3 bg-white text-indigo-700 rounded-xl font-semibold hover:bg-indigo-50 transition-all shadow-lg hover:shadow-xl active:scale-[0.98]">
            <Icon icon="lucide:search" class="w-4 h-4" />
            {{ t("home.hero.searchAction") }}
          </NuxtLink>
          <NuxtLink to="/about" class="inline-flex items-center gap-2 px-6 py-3 bg-white/15 text-white rounded-xl font-medium hover:bg-white/25 transition-all backdrop-blur-sm">
            <Icon icon="lucide:info" class="w-4 h-4" />
            {{ t("home.hero.aboutAction") }}
          </NuxtLink>
        </div>
        <div class="flex gap-8 mt-8 pt-8 border-t border-white/15">
          <div v-for="stat in stats" :key="stat.labelKey" class="text-center">
            <div class="text-2xl font-bold text-white">{{ stat.value }}</div>
            <div class="text-xs text-white/60 mt-1">{{ t(stat.labelKey) }}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- Continue reading (DEC-104, TASK-164): recently viewed posts -->
    <section v-if="recentPosts.length" class="mb-10">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Icon icon="lucide:history" class="w-5 h-5 text-violet-500" />
          {{ t("home.sections.recent") }}
        </h2>
        <NuxtLink
          to="/history"
          class="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-violet-500 transition-colors"
        >
          {{ t("reader.nav.history") }}
          <Icon icon="lucide:chevron-right" class="w-3.5 h-3.5" />
        </NuxtLink>
      </div>
      <div class="flex flex-wrap gap-3">
        <NuxtLink
          v-for="item in recentPosts.slice(0, 6)"
          :key="item.slug"
          :to="`/posts/${item.slug}`"
          class="group flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-100 dark:border-gray-800 hover:border-violet-200 dark:hover:border-violet-800 hover:shadow-md transition-all duration-200"
        >
          <Icon icon="lucide:book-open" class="w-4 h-4 text-violet-400 shrink-0" />
          <span class="text-sm text-gray-700 dark:text-gray-300 group-hover:text-violet-600 dark:group-hover:text-violet-400 truncate max-w-[240px]">
            {{ item.title }}
          </span>
        </NuxtLink>
      </div>
    </section>

    <!-- Recommended for you (DEC-128, TASK-176: personalized, signed-in only;
         ISS-134: gated on content so an empty-recs reader never sees the
         orphaned heading) -->
    <section v-if="recSignedIn && (recommending || recommendedPosts.length)" class="mb-10">
      <h2 class="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
        <Icon icon="lucide:sparkles" class="w-5 h-5 text-fuchsia-500" />
        {{ t("home.sections.recommended") }}
      </h2>

      <!-- Loading skeleton -->
      <div v-if="recommending" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div v-for="i in 3" :key="i" class="h-24 rounded-xl border border-gray-100 dark:border-gray-800 animate-pulse" />
      </div>

      <div v-else-if="recommendedPosts.length" class="grid gap-3 sm:grid-cols-2">
        <NuxtLink
          v-for="post in recommendedPosts.slice(0, 6)"
          :key="post.id"
          :to="`/posts/${post.slug}`"
          class="group p-4 rounded-xl border border-gray-100 dark:border-gray-800 hover:border-fuchsia-200 dark:hover:border-fuchsia-800 hover:shadow-md transition-all duration-200"
        >
          <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 group-hover:text-fuchsia-600 dark:group-hover:text-fuchsia-400 transition-colors line-clamp-2">
            {{ post.title }}
          </h3>
          <div class="mt-2 flex items-center gap-2 text-xs text-gray-400">
            <span v-if="post.category" class="inline-flex items-center gap-1">
              <Icon icon="lucide:folder" class="w-3 h-3" />
              {{ post.category.name }}
            </span>
            <span>{{ post.views }} {{ t("home.posts.views") }}</span>
          </div>
        </NuxtLink>
      </div>
    </section>

    <!-- Your series (DEC-136, TASK-180): personalized, signed-in followers only -->
    <section v-if="followedVisible" class="mb-10">
      <h2 class="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
        <Icon icon="lucide:layers" class="w-5 h-5 text-violet-500" />
        {{ t("home.sections.yourSeries") }}
      </h2>

      <!-- Loading skeleton -->
      <div v-if="followedLoading" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div v-for="i in 3" :key="i" class="h-24 rounded-xl border border-gray-100 dark:border-gray-800 animate-pulse" />
      </div>

      <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="sf in followedSeries"
          :key="sf.id"
          class="p-4 rounded-xl border border-gray-100 dark:border-gray-800 hover:border-violet-200 dark:hover:border-violet-800 hover:shadow-md transition-all duration-200"
        >
          <NuxtLink
            :to="`/series/${sf.slug}`"
            class="text-sm font-semibold text-gray-900 dark:text-gray-100 hover:text-violet-600 dark:hover:text-violet-400 transition-colors line-clamp-2"
          >
            {{ sf.title }}
          </NuxtLink>
          <div v-if="followedProgress[sf.slug]" class="mt-3">
            <div class="flex items-center justify-between gap-2 text-xs text-gray-400">
              <span>
                {{ t('series.readCountLabel', { read: followedProgress[sf.slug]!.read_count, total: followedProgress[sf.slug]!.total }) }}
              </span>
              <NuxtLink
                v-if="!followedProgress[sf.slug]!.completed && followedProgress[sf.slug]!.next_slug"
                :to="`/posts/${followedProgress[sf.slug]!.next_slug}`"
                class="inline-flex items-center gap-1 text-violet-500 hover:text-violet-700 transition-colors"
              >
                {{ t('home.sections.continue') }}
                <Icon icon="lucide:arrow-right" class="w-3 h-3" />
              </NuxtLink>
              <span v-else-if="followedProgress[sf.slug]!.completed">{{ t('series.completed') }}</span>
            </div>
            <div class="mt-1.5 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
              <div
                class="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
                :style="{ width: seriesProgressPercent(followedProgress[sf.slug]!) + '%' }"
              />
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Latest from your follows (DEC-142, TASK-183): signed-in followers only -->
    <section v-if="followsFeedVisible" class="mb-10">
      <h2 class="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
        <Icon icon="lucide:rss" class="w-5 h-5 text-emerald-500" />
        {{ t("home.sections.latestFollows") }}
      </h2>

      <!-- Loading skeleton -->
      <div v-if="followsFeedLoading" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div v-for="i in 3" :key="i" class="h-24 rounded-xl border border-gray-100 dark:border-gray-800 animate-pulse" />
      </div>

      <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <NuxtLink
          v-for="post in followsFeed"
          :key="post.id"
          :to="`/posts/${post.slug}`"
          class="group p-4 rounded-xl border border-gray-100 dark:border-gray-800 hover:border-emerald-200 dark:hover:border-emerald-800 hover:shadow-md transition-all duration-200"
        >
          <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors line-clamp-2">
            {{ post.title }}
          </h3>
          <div class="mt-2 flex items-center gap-2 text-xs text-gray-400">
            <span v-if="post.category" class="inline-flex items-center gap-1">
              <Icon icon="lucide:folder" class="w-3 h-3" />
              {{ post.category.name }}
            </span>
            <span>{{ post.views }} {{ t("home.posts.views") }}</span>
          </div>
        </NuxtLink>
      </div>
    </section>

    <div class="flex flex-col lg:flex-row gap-8">
      <!-- Main posts -->
      <div class="flex-1 min-w-0">
        <!-- Popular posts highlight -->
        <div v-if="popularPosts?.length" class="mb-10">
          <h2 class="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
            <Icon icon="lucide:trending-up" class="w-5 h-5 text-orange-500" />
            {{ t("home.sections.popular") }}
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
                  <p class="text-xs text-gray-400 mt-1">{{ post.views }} {{ t("home.posts.views") }}</p>
                </div>
              </div>
            </NuxtLink>
          </div>
        </div>

        <!-- Section heading -->
        <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 class="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Icon icon="lucide:clock" class="w-5 h-5 text-blue-500" />
            {{ t("home.sections.latest") }}
          </h2>

          <!-- Active filter indicator (deep-link /?category_id= or /?tag_id=) -->
          <div
            v-if="hasActiveFilter"
            class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 dark:bg-blue-950/50 border border-blue-100 dark:border-blue-900/40 text-sm text-blue-700 dark:text-blue-300"
          >
            {{ filterIndicatorText }}
            <button
              type="button"
              class="text-blue-500 hover:text-blue-700 dark:hover:text-blue-200 transition-colors font-semibold"
              :aria-label="t('home.sections.clearFilter')"
              @click="navigateTo({ query: { page: '1' } })"
            >
              {{ t("home.sections.clearFilter") }}
            </button>
          </div>
        </div>

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
          <p>{{ t("common.state.loadFailed") }}</p>
        </div>

        <div v-else-if="posts?.items?.length" class="space-y-5">
          <PostCard v-for="post in posts.items" :key="post.id" :post="post" />

          <!-- Pagination (windowed with ellipsis, RIL TASK-083) -->
          <div v-if="posts.pagination.total_pages > 1" class="flex items-center justify-center gap-2 mt-8">
            <button
              v-for="(pg, i) in paginationTokens"
              :key="pg === '…' ? `ellipsis-${i}` : pg"
              :disabled="pg === '…'"
              :class="[
                'w-9 h-9 rounded-xl text-sm font-medium transition-all duration-200',
                pg === '…'
                  ? 'cursor-default text-gray-400 dark:text-gray-500'
                  : pg === posts.pagination.page
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                    : 'border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800',
              ]"
              @click="pg !== '…' && fetchPosts(pg)"
            >
              {{ pg }}
            </button>
          </div>
        </div>

        <div v-else class="text-center py-16 text-gray-500">
          <Icon icon="lucide:file-text" class="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>{{ t("home.empty.posts") }}</p>
        </div>
      </div>

      <!-- Sidebar -->
      <aside class="lg:w-72 shrink-0">
        <div class="sticky top-24 space-y-6">
          <!-- Stats card -->
          <div class="rounded-2xl bg-gradient-to-br from-blue-50 dark:from-blue-950/50 to-indigo-50 dark:to-indigo-950/50 border border-blue-100 dark:border-blue-900/30 p-5">
            <h3 class="text-sm font-bold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
              <Icon icon="lucide:activity" class="w-4 h-4 text-blue-500" />
              {{ t("home.sidebar.stats") }}
            </h3>
            <div class="space-y-3">
              <div v-for="stat in stats" :key="stat.labelKey" class="flex items-center justify-between text-sm">
                <span class="text-gray-500 dark:text-gray-400">{{ t(stat.labelKey) }}</span>
                <span class="font-semibold text-gray-900 dark:text-gray-100">{{ stat.value }}</span>
              </div>
            </div>
          </div>

          <!-- Browse by category / tag -->
          <div class="rounded-2xl border border-gray-100 dark:border-gray-800 p-5">
            <h3 class="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
              <Icon icon="lucide:compass" class="w-4 h-4 text-indigo-500" />
              {{ t("home.sidebar.browse") }}
            </h3>

            <h4 class="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase mb-2">
              {{ t("home.sidebar.browseCategories") }}
            </h4>
            <div v-if="categories?.length" class="flex flex-wrap gap-2 mb-4">
              <NuxtLink
                v-for="cat in categories"
                :key="cat.id"
                :to="{ query: { category_id: String(cat.id) } }"
                class="px-3 py-1 rounded-full text-xs font-medium transition-all duration-200"
                :class="categoryId === cat.id
                  ? 'bg-gradient-to-r from-purple-500 to-indigo-500 text-white shadow-md'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 hover:text-purple-600'"
              >
                {{ cat.name }}
              </NuxtLink>
            </div>
            <div v-else class="mb-4 text-sm text-gray-400">
              {{ t("home.sidebar.noCategories") }}
            </div>

            <h4 class="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase mb-2">
              {{ t("home.sidebar.browseTags") }}
            </h4>
            <div v-if="tags?.length" class="flex flex-wrap gap-2">
              <NuxtLink
                v-for="tag in tags"
                :key="tag.id"
                :to="{ query: { tag_id: String(tag.id) } }"
                class="px-3 py-1 rounded-full text-xs font-medium transition-all duration-200"
                :class="tagId === tag.id
                  ? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-md'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-pink-100 dark:hover:bg-pink-900/40 hover:text-pink-600'"
              >
                #{{ tag.name }}
              </NuxtLink>
            </div>
            <div v-else class="text-sm text-gray-400">
              {{ t("home.sidebar.noTags") }}
            </div>
          </div>

          <!-- Quick links -->
          <div class="rounded-2xl border border-gray-100 dark:border-gray-800 p-5">
            <h3 class="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
              <Icon icon="lucide:compass" class="w-4 h-4 text-blue-500" />
              {{ t("home.sidebar.quickNav") }}
            </h3>
            <div class="space-y-1">
              <NuxtLink to="/" class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                <Icon icon="lucide:home" class="w-3.5 h-3.5" />{{ t("common.nav.home") }}
              </NuxtLink>
              <NuxtLink to="/about" class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                <Icon icon="lucide:user" class="w-3.5 h-3.5" />{{ t("common.nav.about") }}
              </NuxtLink>
              <NuxtLink to="/search" class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                <Icon icon="lucide:search" class="w-3.5 h-3.5" />{{ t("common.nav.search") }}
              </NuxtLink>
              <a href="https://github.com/pplmx/x-blog" target="_blank" rel="noopener noreferrer" class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                <Icon icon="lucide:github" class="w-3.5 h-3.5" />{{ t("common.nav.github") }}
              </a>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>
