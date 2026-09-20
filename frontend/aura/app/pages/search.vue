<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { PostList } from "~~/api/contracts/shared";
import { usePostSearch } from "~~/api/public/posts";
import {
	type CommentSearchItem,
	type SearchSuggestion,
	type SearchSuggestResponse,
	useCommentSearch,
} from "~~/api/public/search";
// biome-ignore lint/correctness/noUnusedImports: used from the template — biome cannot resolve Vue script-setup template bindings (vue-tsc verifies).
import { effectivePublishTs, parseApiDate } from "~~/composables/apiDate";
import { scrollToPageTop } from "~~/composables/scrollToTop";
import { useBlockedReaderIds } from "~~/composables/useBlockedReaderIds";
import { loadPurify, sanitizeHtml } from "~~/composables/useMarkdown";
import { paginationPages } from "~~/composables/usePagination";
import { useSeo } from "~~/composables/useSeo";
import { commentAuthorName } from "~~/utils/commentAuthorName";

const { t, locale } = useLang();
// used in template v-html (Biome cannot see template usage)
void sanitizeHtml;

const route = useRoute();
// Reactive sources: SPA navigation that only changes query params (e.g.
// /search?q=a → /search?q=b or page=2) must refetch. The computed URL below
// is passed to useFetch, which re-runs when its URL changes.
const query = computed(() => (route.query.q as string) || "");
const page = computed(() => (route.query.page ? Number.parseInt(String(route.query.page), 10) : 1));

// Search MODE (round 366, DEC-405): ?type=comments searches the DISCUSSION
// (approved comments on public posts) instead of posts — the blog's thread is
// its second content asset and used to be unsearchable. Lives in the URL so a
// comment-search share link deep-links into the right mode; anything other
// than "comments" is post search (the pre-existing default).
type SearchMode = "posts" | "comments";
const mode = computed<SearchMode>(() => (route.query.type === "comments" ? "comments" : "posts"));

// Filter state lives in the URL query so a filtered search is shareable and
// survives reload (DEC-084): category/tag by name, sort, and an effective
// publish-time date range (publish_at ?? created_at, matching the feed).
// Each is bound to the route; changing one resets to page 1.
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
	// A filter change resets to page 1, so carry the reader back to the top of
	// the results — without this, a reader at the bottom of a long page-3 set
	// who changes sort/category sees the URL reset but the viewport stay put,
	// which reads as "nothing happened" (survey finding).
	scrollToPageTop();
}

// The current filter set (everything except q/page), reused when paging so
// page-sized navigation never drops an active category/tag/sort/date filter.
const activeFilters = computed(() => {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(route.query)) {
		if (typeof v !== "string" || !v) continue;
		// q/page are navigation, not filters.
		if (k === "q" || k === "page") continue;
		// The search mode is not a narrowing filter (see the hasActiveFilters
		// comment below): in ?type=comments there are no taxonomy/date/sort
		// dimensions at all, so it must not light up the "clear filters"
		// affordance — and its navigation target is identical to the current
		// URL, making the button a dead no-op.
		if (k === "type") continue;
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
// needs every select manually reset (deep-dive finding). The search MODE
// (?type=comments) is not a narrowing filter, so it never lights this up.
const hasActiveFilters = computed(() => Object.keys(activeFilters.value).length > 0);

// Every navigation that must survive a page turn or a mode switch goes through
// these: pageQuery preserves the active post filters, the search mode, and q.
const modeParam = computed(() => (mode.value === "comments" ? { type: "comments" } : {}));
function pageQuery(extra: Record<string, string | undefined>): Record<string, string | undefined> {
	return { ...activeFilters.value, ...modeParam.value, ...extra };
}

function clearFilters(): void {
	// Drop every narrowing filter but keep the query and search mode.
	// Deliberately NOT pageQuery: that merges activeFilters back in, which
	// would make the "clear" button a no-op for the filters it clears.
	navigateTo({ query: { ...modeParam.value, q: query.value, page: "1" } });
}

function setMode(next: SearchMode): void {
	if (next === mode.value) return;
	if (next === "comments") {
		navigateTo({ query: { q: query.value, type: "comments", page: "1" } });
	} else {
		const q: Record<string, string | undefined> = {
			q: query.value,
			page: "1",
			...activeFilters.value,
		};
		delete q.type;
		navigateTo({ query: q });
	}
	scrollToPageTop();
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
// requires q with min_length=1), burning a rate-limit slot on every hit. The
// trim() also treats a whitespace-only ?q=%20 the same as a bare /search —
// the backend rejects blank terms with 422 (round-296 deep-dive), so a
// space-only share link should show the idle prompt, not an error.
const {
	data: searchResult,
	pending,
	error,
	refresh: refreshSearch,
} = await usePostSearch(searchParams, {
	// Post search only fires in posts mode — the comments mode fetches its own
	// result set and must not burn a rate-limit slot on /api/search too.
	enabled: computed(() => mode.value === "posts" && !!query.value.trim()),
	// watch:mode — toggling the search mode back to posts must refetch even
	// though the underlying query params (q/page) are unchanged. Nuxt's
	// `enabled` watcher only aborts when it flips to false; flipping it back to
	// true does NOT re-run the fetch, and the URL getter is mode-independent,
	// so without this watch the mode switch leaves the previous result set
	// frozen (round 366).
	watch: [mode],
});
function retrySearch() {
	void refreshSearch();
}

// Comment search (round 366, DEC-405): the reactive URL pattern is identical
// to usePostSearch — a computed params object refetches on q/page/mode change.
const commentSearchParams = computed(() => ({
	q: query.value,
	page: page.value,
	limit: 10,
}));
const {
	data: commentResult,
	pending: commentsPending,
	error: commentsError,
	refresh: refreshComments,
} = await useCommentSearch(commentSearchParams, {
	enabled: computed(() => mode.value === "comments" && !!query.value.trim()),
	// watch:mode — flipping INTO comments mode must fire the comment search
	// (see the post-search watch:mode note above).
	watch: [mode],
});
function retryComments() {
	void refreshComments();
}

// The ACTIVE result set is whatever the current mode renders: the post search
// result or the comment search result. Every results-area binding goes through
// these so a mode switch rides one rendering pipeline.
const activeResult = computed(() =>
	mode.value === "comments" ? commentResult.value : searchResult.value,
);
const activePending = computed(() =>
	mode.value === "comments" ? commentsPending.value : pending.value,
);
const activeError = computed(() => (mode.value === "comments" ? commentsError.value : error.value));

// "Did you mean" suggestions (round 390, DEC-443): the post search is exact
// substring + tsvector, so a zero-hit page is a dead end with no recovery path.
// The suggest endpoint scores a bounded vocabulary (tag/category names +
// recent public post titles) with client-agnostic edit distance; it shares the
// search rate-limit bucket, so it must NEVER fire unless a POST search already
// returned zero hits — `shouldSuggest` is that exact gate (posts mode, a real
// term, the posts query has landed, and its total is 0).
//
// The fetch is deliberately an IMPERATIVE $fetch driven by the watch, not a
// `useSearchSuggest` composable: Nuxt refuses to re-fire useFetch when its
// `enabled` flips false→true (it only ABORTS on the false edge), and this
// zero-hit trigger is exactly that detection — we want a fresh request the
// moment the result set degenerates to 0. Same $fetch idiom as loadTaxonomy.
const SUGGEST_LIMIT = 4;
const shouldSuggest = computed(
	() =>
		mode.value === "posts" &&
		!!query.value.trim() &&
		// `!error` not `=== null`: Nuxt's useFetch `error` ref is `undefined`
		// until a failure happens (round-390 debug: the SSR-rendered empty
		// state had total=0 but error=undefined, so a strict null check made
		// shouldSuggest stay false and the suggestion request never fired).
		!activeError.value &&
		// No data yet → treat as non-zero (a zero-hit page is the ONLY trigger:
		// suggestions share the search rate-limit bucket, so they must never
		// fire for a search that actually returned hits).
		(searchResult.value?.pagination.total ?? 1) === 0,
);
const suggestions = ref<SearchSuggestion[]>([]);
let suggestSeq = 0;
watch(
	// Both sources: a zero-hit→zero-hit term change keeps shouldSuggest true
	// (Nuxt useFetch PRESERVES the previous zero-hit payload during the refetch),
	// so a shouldSuggest-only watcher never re-fires and the OLD term's chips
	// stick under the box, wrong for the new term (deep-dive finding). Watching
	// the term too re-requests suggestions on every committed query change while
	// the state stays zero-hit.
	[shouldSuggest, () => query.value],
	async ([now]) => {
		const seq = ++suggestSeq;
		if (!now) {
			// Leaving the zero-hit state (new term landed with results, or the
			// reader cleared the query) clears the chips.
			suggestions.value = [];
			return;
		}
		try {
			const resp = await $fetch<SearchSuggestResponse>(
				`/api/search/suggest?q=${encodeURIComponent(query.value)}&limit=${SUGGEST_LIMIT}`,
			);
			if (seq !== suggestSeq) return; // a newer watch fired; drop the stale reply
			// `?? []` guards a malformed/empty payload — the render reads
			// `suggestions.length`, so an undefined here would crash it.
			suggestions.value = resp?.suggestions ?? [];
		} catch {
			if (seq === suggestSeq) suggestions.value = [];
		}
	},
	// immediate is REQUIRED, not an optimization: landing on /search?q=tyop is
	// the primary flow, and there the posts query resolves to zero hits BEFORE
	// the watch exists — shouldSuggest is already true, so a transition-only
	// watch would never fire and the suggestion request would never go out.
	{ immediate: true },
);

// Tap a suggestion to retry the search with the corrected term. Goes through
// pageQuery so any active category/tag/sort/date narrowing and the search mode
// survive — a suggestion is a term fix, not a reset.
function applySuggestion(term: string) {
	navigateTo({ query: pageQuery({ q: term, page: "1" }) });
}

// Typed per-mode result lists so the template loops (posts vs comments) always
// see the item shape their branch renders — the union on activeResult cannot
// be narrowed by `mode` inside v-for.
const activePosts = computed<PostList[]>(() =>
	mode.value === "posts" ? (searchResult.value?.items ?? []) : [],
);
// Blocked-reader suppression (round 386, DEC-437): a signed-in viewer's block
// list (receiver-side opt-out, DEC-425) filters blocked authors' hits out of
// comment search results, exactly like the thread and the discussion feed.
const { blockedReaderIds, loadBlockedReaderIds } = useBlockedReaderIds();
onMounted(() => {
	void loadBlockedReaderIds();
});
const activeComments = computed<CommentSearchItem[]>(() => {
	const items = mode.value === "comments" ? (commentResult.value?.items ?? []) : [];
	return items.filter((c) => !c.reader || !blockedReaderIds.value.has(c.reader.id));
});

// Windowed, ellipsis-aware pagination buttons (RIL TASK-083, ISS-052).
const paginationTokens = computed(() =>
	paginationPages(
		activeResult.value?.pagination?.total_pages ?? 0,
		activeResult.value?.pagination?.page ?? 1,
	),
);

// Out-of-range deep link (e.g. /search?q=foo&page=5 on a dataset that now has
// 2 pages): the backend returns an empty list with total_pages < requested, and
// the empty-state block hides the pagination bar — a dead end with no way back
// except hand-editing the URL. When the server reports the last page we're past
// it, jump the URL to that last page so the reader lands on real results.
watch(
	() => activeResult.value?.pagination,
	(p) => {
		const requested = Number.parseInt(String(route.query.page), 10);
		if (!p || Number.isNaN(requested) || requested < 2) return;
		const last = p.total_pages ?? 1;
		if (requested > last && last >= 1) {
			// pageQuery preserves the active mode + post filters.
			navigateTo({ query: pageQuery({ q: query.value, page: String(last) }), replace: true });
		}
	},
);

// Upgrade snippet sanitization to DOMPurify as soon as it loads (results that
// arrive later re-render through the stronger sanitizer), and preload the
// category/tag lists for the filter selects (DEC-084).
const categories = ref<{ id: number; name: string }[]>([]);
const tags = ref<{ id: number; name: string }[]>([]);
// A taxonomy fetch failure must not look like "there are no categories/tags":
// the selects would silently shrink to just "All" with no explanation (survey
// finding). Flag it and offer a retry right by the filters.
const taxonomyFailed = ref(false);
async function loadTaxonomy() {
	taxonomyFailed.value = false;
	await Promise.all([
		$fetch<{ id: number; name: string }[]>("/api/categories")
			.then((v) => {
				categories.value = v ?? [];
			})
			.catch(() => {
				taxonomyFailed.value = true;
			}),
		$fetch<{ id: number; name: string }[]>("/api/tags")
			.then((v) => {
				tags.value = v ?? [];
			})
			.catch(() => {
				taxonomyFailed.value = true;
			}),
	]);
}
onMounted(() => {
	void loadPurify();
	void loadTaxonomy();
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
	locale: locale.value,
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
	if (!q) {
		// Empty term in the results view means "clear the search": there was no
		// way back to the bare /search landing from the results view — the
		// native type="search" clear (×) left an empty box under stale results
		// and Empty+Enter was a silent no-op. The empty-query landing's input is
		// unaffected (nothing to clear, query already empty → no-op below).
		handleTermCleared();
		return;
	}
	if (q !== query.value) {
		// New term: merge into the existing filters (category/tag/sort/date)
		// and search mode instead of replacing the whole query — dropping them
		// on every Enter made a refined search silently lose its filters
		// (deep-dive finding). Page resets to 1 for the fresh result set.
		navigateTo({ query: pageQuery({ q, page: "1" }) });
	}
}

/**
 * Return from a live search to the bare /search landing. Only acts when the
 * box is actually empty AND a query is showing (so Enter on the empty-query
 * landing's own box stays a no-op). Tied to the native type="search" clear
 * event (Chromium ×) and to a manually-emptied Enter.
 */
function handleTermCleared() {
	if (searchInput.value.trim() !== "" || !query.value) return;
	navigateTo({ query: {} });
}

// Paging from the bottom of the results list swaps it in place; return the
// reader to the top so the new page is visible above the fold (same behaviour
// the home feed established for its pagination). Keeps every active filter
// and the search mode.
function goToPage(pg: number | string) {
	// paginationTokens are numbers; the URL query is string-typed.
	navigateTo({ query: pageQuery({ q: query.value, page: String(pg) }) });
	scrollToPageTop();
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

    <!-- Search results view. Deliberately NOT a top-level pending/error branch:
         the editable query box and every filter below must stay mounted during
         refetches (pagination, filter change, new term) — a whole-block skeleton
         unmounted them, silently dropping keyboard focus to <body> and hiding
         the controls the reader needs mid-interaction. Only the results area
         below reflects pending/error. -->
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
            @search="handleTermCleared"
          >
          <Icon
            icon="lucide:search"
            class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none"
          />
        </div>
      </div>

      <!-- Search mode (round 366, DEC-405): posts (default) or comments.
           ?type=comments lives in the URL, so a shared comment-search link
           lands straight on the discussion mode. -->
      <div
        role="tablist"
        :aria-label="t('search.mode.label')"
        class="mb-6 flex w-fit items-center gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-900"
      >
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'posts'"
          :aria-pressed="mode === 'posts'"
          class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
          :class="mode === 'posts'
            ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'"
          @click="setMode('posts')"
        >
          <Icon icon="lucide:file-text" class="w-3.5 h-3.5 inline-block mr-1" />
          {{ t('search.mode.posts') }}
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'comments'"
          :aria-pressed="mode === 'comments'"
          class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
          :class="mode === 'comments'
            ? 'bg-white dark:bg-gray-700 text-emerald-600 dark:text-emerald-400 shadow-sm'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'"
          @click="setMode('comments')"
        >
          <Icon icon="lucide:message-square" class="w-3.5 h-3.5 inline-block mr-1" />
          {{ t('search.mode.comments') }}
        </button>
      </div>

      <!-- Header -->
      <div class="mb-8">
        <h1
          class="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent"
        >
          {{ t(mode === "comments" ? "search.results.commentsTitle" : "search.results.title") }}
        </h1>
        <p class="text-gray-500 dark:text-gray-400 mt-2">
          {{ t(
            mode === "comments" ? "search.results.commentsSummary" : "search.results.summary",
            { query, count: activeResult?.pagination?.total || 0 },
          ) }}
        </p>
      </div>

      <!-- Filters (DEC-084): category/tag/date-range narrowing + sort. Values
           live in the URL so a filtered search is shareable. Posts-only — a
           comment search has no taxonomy/sort/date dimensions. -->
      <div v-if="mode === 'posts'" class="flex flex-wrap items-end gap-3 mb-6">
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
            :max="filterDateTo || undefined"
            class="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            @change="setFilter('date_from', ($event.target as HTMLInputElement).value)"
          >
        </label>
        <label class="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          {{ t("search.filters.dateTo") }}
          <input
            :value="filterDateTo"
            type="date"
            :min="filterDateFrom || undefined"
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

      <!-- Taxonomy load failure (survey finding): never let a failed category/
           tag fetch look like "there are no categories/tags" — say why the
           selects are thin and offer a retry. -->
      <p
        v-if="mode === 'posts' && taxonomyFailed"
        role="alert"
        class="mb-6 flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400"
      >
        <Icon icon="lucide:triangle-alert" class="w-4 h-4 shrink-0" aria-hidden="true" role="presentation" />
        {{ t("search.filters.loadFailed") }}
        <button
          type="button"
          class="px-2 py-1 rounded-lg text-xs font-medium border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
          @click="loadTaxonomy"
        >
          {{ t("common.action.retry") }}
        </button>
      </p>

      <!-- Results area: only here do loading/error swap in, leaving the query
           box and filters mounted (see note at the top of the results view).
           Which result set renders is decided by the active mode. -->
      <div v-if="activePending" class="space-y-4">
        <div class="bg-gray-100 animate-pulse h-8 rounded-lg mb-4 w-1/3" />
        <div
          v-for="i in 3"
          :key="i"
          class="bg-gray-100 animate-pulse h-24 rounded-lg"
        />
      </div>

      <div
        v-else-if="activeError"
        class="text-center py-12 text-gray-500"
      >
        <p class="mb-4">{{ t("search.error") }}</p>
        <button
          type="button"
          role="alert"
          class="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          @click="mode === 'comments' ? retryComments() : retrySearch()"
        >
          {{ t("common.action.retry") }}
        </button>
      </div>

      <!-- Empty results. Gates on the lists that actually render, not the
           server totals: in comments mode that is the blocked-filtered
           activeComments, so a page whose every hit is by a blocked reader
           shows the empty state instead of a blank area under a misleading
           "N results" header (round 386, DEC-437). -->
      <div
        v-else-if="!activePosts.length && !activeComments.length"
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
        <!-- A negative result caused by a category/tag/date filter must not be
             blamed on the keywords — narrow a filter far enough and "try
             different keywords" misleads the reader away from the actual cause
             (round 278). Name the filter and offer the one-click reset. -->
        <p class="text-sm text-gray-500 dark:text-gray-400">
          {{ hasActiveFilters ? t("search.noResults.tryAdjustFilters") : t("search.noResults.hint") }}
        </p>
        <button
          v-if="hasActiveFilters"
          type="button"
          class="mt-3 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
          @click="clearFilters"
        >
          <Icon icon="lucide:filter-x" class="w-3.5 h-3.5" />
          {{ t("search.filters.clearAll") }}
        </button>

        <!-- "Did you mean" recovery (round 390, DEC-443): the exact-substring
             post search has no fuzzy layer, so a typo'd or half-remembered
             term dead-ends here. Offer edit-distance neighbors from the
             backend; tapping one re-runs the search with the corrected term. -->
        <div
          v-if="suggestions.length"
          role="region"
          :aria-label="t('search.suggest.label')"
          class="mt-6 w-full max-w-md"
        >
          <p class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
            {{ t("search.suggest.label") }}
          </p>
          <div class="flex flex-wrap justify-center gap-2">
            <button
              v-for="s in suggestions"
              :key="`${s.kind}:${s.text}`"
              type="button"
              class="inline-flex items-center gap-1.5 rounded-full border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 px-3 py-1.5 text-sm font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
              @click="applySuggestion(s.text)"
            >
              {{ s.text }}
              <span
                v-if="s.hits > 1"
                class="text-xs text-blue-500 dark:text-blue-400"
              >
                {{ t("search.suggest.postsCount", { count: s.hits }) }}
              </span>
            </button>
          </div>
        </div>
      </div>

      <!-- Results list -->
      <div
        v-else
        class="space-y-6"
      >
        <!-- POST results (default mode) -->
        <template v-if="mode === 'posts'">
          <div
            v-for="post in activePosts"
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
                {{ parseApiDate(effectivePublishTs(post))?.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US") ?? "" }}
              </span>
              <span>{{ post.views }} {{ t("search.posts.views") }}</span>
            </div>
          </div>
        </template>

        <!-- COMMENT results (round 366, DEC-405): a hit carries the post brief
             and deep-links ONTO the comment (DEC-321), never just the post. -->
        <template v-else>
          <div
            v-for="comment in activeComments"
            :key="comment.id"
            class="border border-gray-100 rounded-lg p-6 hover:shadow-md transition-shadow"
          >
            <NuxtLink
              :to="comment.post ? `/posts/${comment.post.slug}#comment-${comment.id}` : '#'"
              class="inline-flex items-center gap-2 text-lg font-bold hover:text-emerald-600"
            >
              <Icon icon="lucide:message-square" class="w-4 h-4 text-emerald-500 shrink-0" />
              {{ comment.post?.title ?? t("search.comments.orphanPost") }}
            </NuxtLink>
            <!-- The backend snippet is mark-safe (escaped before <mark>); go
                 through sanitizeHtml like the post snippets. -->
            <p
              v-if="comment.snippet"
              class="text-gray-600 mt-2 line-clamp-3"
              v-html="sanitizeHtml(comment.snippet)"
            />
            <p v-else class="text-gray-600 mt-2 line-clamp-3">{{ comment.content }}</p>
            <div class="flex flex-wrap gap-4 mt-3 text-sm text-gray-500">
              <span class="inline-flex items-center gap-1">
                <Icon icon="lucide:user" class="w-3.5 h-3.5" aria-hidden="true" />
                {{ commentAuthorName(comment, t("components.commentList.readerNoName")) }}
              </span>
              <span>
                {{ parseApiDate(comment.created_at)?.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US") ?? "" }}
              </span>
              <span class="text-emerald-500 dark:text-emerald-400">
                {{ t("search.comments.jumpTo") }}
              </span>
            </div>
          </div>
        </template>

        <!-- Pagination (windowed with ellipsis, RIL TASK-083) — shared by both
             modes; the active result set decides the page count. -->
        <div
          v-if="activeResult!.pagination.total_pages > 1"
          class="flex justify-center gap-2 mt-8"
        >
          <button
            v-for="(pg, i) in paginationTokens"
            :key="pg === '…' ? `ellipsis-${i}` : pg"
            :disabled="pg === '…' || pg === activeResult!.pagination.page"
            :aria-current="pg !== '…' && pg === activeResult!.pagination.page ? 'page' : undefined"
            :class="[
              'px-3 py-1 rounded',
              pg === '…'
                ? 'cursor-default text-gray-400'
                : pg === activeResult!.pagination.page
                  ? 'bg-blue-600 text-white cursor-default'
                  : 'border hover:bg-gray-50',
            ]"
            @click="pg !== '…' && pg !== activeResult!.pagination.page && goToPage(pg)"
          >
            {{ pg }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
