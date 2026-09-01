<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { usePostSearch } from "~~/api/public/posts";
// biome-ignore lint/correctness/noUnusedImports: used from the template — biome cannot resolve Vue script-setup template bindings (vue-tsc verifies).
import { parseApiDate } from "~~/composables/apiDate";
import { loadPurify, sanitizeHtml } from "~~/composables/useMarkdown";
import { paginationPages } from "~~/composables/usePagination";
import { useSeo } from "~~/composables/useSeo";

const { t, locale } = useLang();
// used in template v-html (Biome cannot see template usage)
void sanitizeHtml;

const route = useRoute();
// Reactive sources: SPA navigation that only changes query params (e.g.
// /search?q=a → /search?q=b or page=2) must refetch. The computed URL below
// is passed to useFetch, which re-runs when its URL changes.
const query = computed(() => (route.query.q as string) || "");
const page = computed(() => (route.query.page ? Number.parseInt(String(route.query.page), 10) : 1));

// Filter state lives in the URL query so a filtered search is shareable and
// survives reload (DEC-084): category/tag by name, sort, and a created_at
// range. Each is bound to the route; changing one resets to page 1.
const filterCategory = computed(() => (route.query.category as string) || "");
const filterTag = computed(() => (route.query.tag as string) || "");
const filterSort = computed(() => (route.query.sort as string) || "relevance");
const filterDateFrom = computed(() => (route.query.date_from as string) || "");
const filterDateTo = computed(() => (route.query.date_to as string) || "");

function setFilter(key: string, value: string): void {
	const merged: Record<string, string> = {};
	for (const [k, v] of Object.entries(route.query)) {
		if (typeof v === "string" && v) merged[k] = v;
	}
	if (value) merged[key] = value;
	else delete merged[key];
	merged.page = "1"; // a filter change starts a fresh result set
	navigateTo({ query: merged });
}

// The current filter set (everything except q/page), reused when paging so
// page-sized navigation never drops an active category/tag/sort/date filter.
const activeFilters = computed(() => {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(route.query)) {
		if (typeof v !== "string" || !v) continue;
		if (k === "q" || k === "page") continue;
		// A default `relevance` sort is not a narrowing filter: it is what the
		// API does anyway (searchParams omits it too), so it must not light up
		// the "clear filters" button or survive a clear. (search-filters e2e)
		if (k === "sort" && v === "relevance") continue;
		out[k] = v;
	}
	return out;
});

// True when any narrowing filter (category/tag/sort/date) is active — gates the
// one-click "clear filters" affordance so a filtered search isn't a trap that
// needs every select manually reset (deep-dive finding).
const hasActiveFilters = computed(() => Object.keys(activeFilters.value).length > 0);

function clearFilters(): void {
	// Drop every narrowing filter, keep the query, reset to page 1.
	navigateTo({ query: { q: query.value, page: "1" } });
}

// Search params mirror the previous URL construction: `withQuery` omits empty
// strings and undefined values, so a default `relevance` sort and empty
// category/tag/date filters leave no trailing query params behind. `q` is
// always sent (it is the search term).
const searchParams = computed(() => ({
	q: query.value,
	category: filterCategory.value,
	tag: filterTag.value,
	sort: filterSort.value !== "relevance" ? filterSort.value : undefined,
	date_from: filterDateFrom.value,
	date_to: filterDateTo.value,
	page: page.value,
	limit: 10,
}));

// With no query there is nothing to search: `enabled: false` makes Nuxt skip
// the request (reactively re-enabling on SPA nav to ?q=...). Without this the
// empty URL fired a guaranteed-422 request per bare /search visit (the backend
// requires q with min_length=1), burning a rate-limit slot on every hit.
const {
	data: searchResult,
	pending,
	error,
	refresh: refreshSearch,
} = await usePostSearch(searchParams, {
	enabled: computed(() => !!query.value),
});
function retrySearch() {
	void refreshSearch();
}

// Windowed, ellipsis-aware pagination buttons (RIL TASK-083, ISS-052).
const paginationTokens = computed(() =>
	paginationPages(
		searchResult.value?.pagination?.total_pages ?? 0,
		searchResult.value?.pagination?.page ?? 1,
	),
);

// Out-of-range deep link (e.g. /search?q=foo&page=5 on a dataset that now has
// 2 pages): the backend returns an empty list with total_pages < requested, and
// the empty-state block hides the pagination bar — a dead end with no way back
// except hand-editing the URL. When the server reports the last page we're past
// it, jump the URL to that last page so the reader lands on real results.
watch(
	() => searchResult.value?.pagination,
	(p) => {
		const requested = Number.parseInt(String(route.query.page), 10);
		if (!p || Number.isNaN(requested) || requested < 2) return;
		const last = p.total_pages ?? 1;
		if (requested > last && last >= 1) {
			const next = {
				...(activeFilters.value as Record<string, string>),
				q: query.value,
				page: String(last),
			};
			navigateTo({ query: next, replace: true });
		}
	},
);

// Upgrade snippet sanitization to DOMPurify as soon as it loads (results that
// arrive later re-render through the stronger sanitizer), and preload the
// category/tag lists for the filter selects (DEC-084).
const categories = ref<{ id: number; name: string }[]>([]);
const tags = ref<{ id: number; name: string }[]>([]);
onMounted(async () => {
	void loadPurify();
	const [cats, tgs] = await Promise.all([
		$fetch<{ id: number; name: string }[]>("/api/categories").catch(() => []),
		$fetch<{ id: number; name: string }[]>("/api/tags").catch(() => []),
	]);
	categories.value = cats;
	tags.value = tgs;
});

// SEO: set dynamic head metadata based on search query. Passed as a getter so
// SPA navigation between ?q= values updates the <title>/canonical (RIL
// TASK-080; useSeo accepts () => SeoOptions).
useSeo(() => ({
	title: query.value
		? t("search.seo.titleWithQuery", { query: query.value })
		: t("search.seo.title"),
	description: query.value
		? t("search.seo.descWithQuery", { query: query.value })
		: t("search.seo.description"),
	path: query.value ? `/search?q=${encodeURIComponent(query.value)}` : "/search",
	noindex: true,
}));

// Search input handler: navigate to /search?q=keyword on Enter.
// IMPORTANT: submitting a NEW query must reset page to 1 — navigateTo with a
// query object merges into the current route, so without this a search fired
// from /search?q=foo&page=3 would land on /search?q=bar&page=3 (an out-of-range
// page of the new results).
const searchInput = ref("");
// Keep the input in sync with the current query so an SPA navigation to
// /search?q=foo (e.g. from the header search link) AND a fresh deep-link
// load both show the term in the box (immediate:true covers the initial
// mount — previously a /search?q=... landing showed a blank results-view
// input despite results being for that query).
watch(
	query,
	(q) => {
		searchInput.value = q;
	},
	{ immediate: true },
);
function handleSearchInput() {
	const q = searchInput.value.trim();
	if (!q) return;
	if (q !== query.value) {
		// New term: merge into the existing filters (category/tag/sort/date)
		// instead of replacing the whole query — dropping them on every Enter
		// made a refined search silently lose its filters (deep-dive finding).
		// Page resets to 1 for the fresh result set.
		navigateTo({ query: { ...activeFilters.value, q, page: "1" } });
	}
}
</script>

<template>
  <div class="max-w-5xl mx-auto">
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
        {{ t("search.empty.title") }}
      </h2>
      <p class="text-gray-500 dark:text-gray-400 mb-6">
        {{ t("search.empty.hint") }}
      </p>
      <div class="w-full max-w-md">
        <div class="relative">
          <input
            v-model="searchInput"
            type="text"
            :placeholder="t('search.placeholder')"
            :aria-label="t('search.placeholder')"
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
      <p class="mb-4">{{ t("search.error") }}</p>
      <button
        type="button"
        class="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        @click="retrySearch"
      >
        {{ t("common.action.retry") }}
      </button>
    </div>

    <!-- Search results -->
    <div v-else>
      <!-- Header with an editable query box so a reader who landed on
           /search?q=... (header/home search, or a shared deep link) can refine
           the term in place instead of being stuck with a frozen query. -->
      <div class="mb-6 w-full max-w-md">
        <div class="relative">
          <input
            v-model="searchInput"
            type="search"
            :placeholder="t('search.placeholder')"
            :aria-label="t('search.placeholder')"
            class="w-full pl-10 pr-4 py-3 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            @keydown.enter="handleSearchInput"
          >
          <Icon
            icon="lucide:search"
            class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none"
          />
        </div>
      </div>

      <!-- Header -->
      <div class="mb-8">
        <h1
          class="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent"
        >
          {{ t("search.results.title") }}
        </h1>
        <p class="text-gray-500 dark:text-gray-400 mt-2">
          {{ t("search.results.summary", { query, count: searchResult?.pagination?.total || 0 }) }}
        </p>
      </div>

      <!-- Filters (DEC-084): category/tag/date-range narrowing + sort. Values
           live in the URL so a filtered search is shareable. -->
      <div class="flex flex-wrap items-end gap-3 mb-6">
        <label class="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          {{ t("search.filters.category") }}
          <select
            :value="filterCategory"
            class="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            @change="setFilter('category', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ t("search.filters.allCategories") }}</option>
            <option v-for="c in categories" :key="c.id" :value="c.name">{{ c.name }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          {{ t("search.filters.tag") }}
          <select
            :value="filterTag"
            class="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            @change="setFilter('tag', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ t("search.filters.allTags") }}</option>
            <option v-for="tag in tags" :key="tag.id" :value="tag.name">{{ tag.name }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          {{ t("search.filters.sort") }}
          <select
            :value="filterSort"
            class="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            @change="setFilter('sort', ($event.target as HTMLSelectElement).value)"
          >
            <option value="relevance">{{ t("search.filters.sortRelevance") }}</option>
            <option value="newest">{{ t("search.filters.sortNewest") }}</option>
            <option value="oldest">{{ t("search.filters.sortOldest") }}</option>
            <option value="views">{{ t("search.filters.sortViews") }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          {{ t("search.filters.dateFrom") }}
          <input
            :value="filterDateFrom"
            type="date"
            class="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            @change="setFilter('date_from', ($event.target as HTMLInputElement).value)"
          >
        </label>
        <label class="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          {{ t("search.filters.dateTo") }}
          <input
            :value="filterDateTo"
            type="date"
            class="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            @change="setFilter('date_to', ($event.target as HTMLInputElement).value)"
          >
        </label>
        <!-- One-click reset: a filtered search must never be a trap that needs
             every select manually restored (deep-dive finding). -->
        <button
          v-if="hasActiveFilters"
          type="button"
          class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
          @click="clearFilters"
        >
          <Icon icon="lucide:filter-x" class="w-3.5 h-3.5" />
          {{ t("search.filters.clearAll") }}
        </button>
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
          {{ t("search.noResults.title") }}
        </h3>
        <p class="text-sm text-gray-500 dark:text-gray-400">
          {{ t("search.noResults.hint") }}
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
            v-if="post.snippet"
            class="text-gray-600 mt-2 line-clamp-3"
            v-html="sanitizeHtml(post.snippet)"
          />
          <p
            v-else-if="post.excerpt"
            class="text-gray-600 mt-2 line-clamp-2"
          >
            {{ post.excerpt }}
          </p>
          <div class="flex gap-4 mt-3 text-sm text-gray-500">
            <span v-if="post.category">
              {{ post.category.name }}
            </span>
            <span>
              {{ parseApiDate(post.created_at)?.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US") ?? "" }}
            </span>
            <span>{{ post.views }} {{ t("search.posts.views") }}</span>
          </div>
        </div>

        <!-- Pagination (windowed with ellipsis, RIL TASK-083) -->
        <div
          v-if="searchResult.pagination.total_pages > 1"
          class="flex justify-center gap-2 mt-8"
        >
          <button
            v-for="(pg, i) in paginationTokens"
            :key="pg === '…' ? `ellipsis-${i}` : pg"
            :disabled="pg === '…'"
            :aria-current="pg !== '…' && pg === searchResult.pagination.page ? 'page' : undefined"
            :class="[
              'px-3 py-1 rounded',
              pg === '…'
                ? 'cursor-default text-gray-400'
                : pg === searchResult.pagination.page
                  ? 'bg-blue-600 text-white'
                  : 'border hover:bg-gray-50',
            ]"
            @click="pg !== '…' && navigateTo({ query: { ...activeFilters, q: query, page: pg } })"
          >
            {{ pg }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
