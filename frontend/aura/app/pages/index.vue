<script setup lang="ts">
import {
	type PostListResponse,
	useBlogStats,
	useCategories,
	usePopularPosts,
	useTags,
} from "~~/composables/useApi";
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

// Build URL from the page + filter refs.  Because useFetch watches these,
// changes trigger a re-fetch with the new URL.
const apiUrl = computed(() => {
	const params = new URLSearchParams();
	params.set("page", String(page.value));
	params.set("limit", "10");
	if (categoryId.value) params.set("category_id", String(categoryId.value));
	if (tagId.value) params.set("tag_id", String(tagId.value));
	return `/api/posts?${params.toString()}`;
});

// Reset to page 1 when the active category/tag filter changes, so we don't
// land past the end of a newly filtered result set.
watch([categoryId, tagId], () => {
	if (page.value !== 1) page.value = 1;
});

const config = useRuntimeConfig();
const {
	data: posts,
	pending,
	error,
} = await useFetch<PostListResponse>(apiUrl, {
	baseURL: config.public.apiUrl,
	watch: [page, categoryId, tagId],
});

const { data: popularPosts } = await usePopularPosts();

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

useSeo({
	title: t("home.seo.title"),
	description: t("home.seo.description"),
	path: "/",
});

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
            v-if="activeFilterLabel"
            class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 dark:bg-blue-950/50 border border-blue-100 dark:border-blue-900/40 text-sm text-blue-700 dark:text-blue-300"
          >
            {{ t("home.sections.filtered", { label: activeFilterLabel }) }}
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
