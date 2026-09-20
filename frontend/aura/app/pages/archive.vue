<script setup lang="ts">
import { computed, ref } from "vue";
import { type ArchiveEntry, usePostArchive, usePosts } from "~~/api/public/posts";
// biome-ignore lint/correctness/noUnusedImports: used from the template — biome cannot resolve Vue script-setup template bindings (vue-tsc verifies).
import { effectivePublishTs, parseApiDate } from "~~/composables/apiDate";
import { scrollToPageTop } from "~~/composables/scrollToTop";
import { paginationPages } from "~~/composables/usePagination";
import { useSeo } from "~~/composables/useSeo";

const { t, locale } = useLang();
const route = useRoute();
// Reactive sources so SPA navigation that changes only query params
// (year / month / page) refetches — the computed URL drives useFetch.
const year = computed(() =>
	route.query.year ? Number.parseInt(String(route.query.year), 10) : undefined,
);
const month = computed(() =>
	route.query.month ? Number.parseInt(String(route.query.month), 10) : undefined,
);
const page = computed(() => (route.query.page ? Number.parseInt(String(route.query.page), 10) : 1));

// Only fetch posts when a year/month is actually selected (index view has no
// post list). `enabled: false` makes Nuxt skip the request without firing it.
const hasPeriod = computed(() => !!year.value || !!month.value);

// Year/month/page filters mirror the previous URL construction: `withQuery`
// omits undefined values, so page 1, an empty year, or an empty month leave no
// trailing query params behind.
const postsFilters = computed(() => ({
	year: year.value,
	month: month.value,
	page: page.value > 1 ? page.value : undefined,
}));

const {
	data: archive,
	pending: archivePending,
	error: archiveError,
	refresh: refreshArchive,
} = await usePostArchive();
const {
	data: posts,
	pending: postsPending,
	error: postsError,
	refresh: refreshPosts,
} = await usePosts(postsFilters, { enabled: hasPeriod });
// The archive-index fetch and the posts fetch are independent. A year→month SPA
// navigation refetches only the posts (the archive URL never changes), so the
// index view must NOT be gated on the combined pending — it would flash a
// whole-page skeleton and unmount the year/month list on every switch. Gate the
// index view on the archive fetch alone, and the period view's results region
// on the posts pending/error instead (search.vue pattern).
function retryArchive() {
	void refreshArchive();
}
function retryPosts() {
	void refreshPosts();
}

// Paging from the bottom of the grid swaps it in place; return the reader to
// the top so the new page is visible above the fold (same behaviour the home
// feed established for its pagination).
function goToPage(pg: number | string) {
	navigateTo({
		query: {
			...(year.value ? { year: String(year.value) } : {}),
			...(month.value ? { month: String(month.value) } : {}),
			page: pg,
		},
	});
	scrollToPageTop();
}

// Group flat (year, month, count) buckets into years, newest first.
const years = computed<{ year: number; months: ArchiveEntry[] }[]>(() => {
	const map = new Map<number, ArchiveEntry[]>();
	for (const entry of archive.value ?? []) {
		const list = map.get(entry.year) ?? [];
		list.push(entry);
		map.set(entry.year, list);
	}
	return [...map.entries()]
		.sort((a, b) => b[0] - a[0])
		.map(([year, months]) => ({ year, months: months.sort((a, b) => b.month - a.month) }));
});

// Archive index narrowing filter (survey finding): on a multi-year blog the
// year/month pill stack is long and unscannable with no way to jump — the
// exact problem tags/categories fixed in ISS-381. Filter the month pills by
// label/years text (localized label + year/month digits).
const archiveQuery = ref("");
const filteredYears = computed<{ year: number; months: ArchiveEntry[] }[]>(() => {
	const q = archiveQuery.value.trim().toLowerCase();
	if (!q) return years.value;
	const label = (m: ArchiveEntry) =>
		new Date(Date.UTC(m.year, m.month - 1, 1)).toLocaleString(
			locale.value === "zh" ? "zh-CN" : "en-US",
			{ month: "long" },
		);
	const matches = (m: ArchiveEntry) =>
		label(m).toLowerCase().includes(q) || String(m.year).includes(q) || String(m.month).includes(q);
	return years.value
		.map((y) => ({ year: y.year, months: y.months.filter(matches) }))
		.filter((y) => y.months.length > 0);
});

// Look up month label for display/SEO. Always returns a string so the i18n
// translator receives a concrete value (never undefined).
const monthLabel = computed(() => {
	if (!month.value) return "";
	return new Date(Date.UTC(2000, month.value - 1, 1)).toLocaleString(
		locale.value === "zh" ? "zh-CN" : "en-US",
		{ month: "long" },
	);
});

// Flatten the year buckets into one chronologically-ordered list of months that
// actually hold posts, newest first — the navigation bounds for paging between
// archive months. Ordering derived from `years` (already grouped/sorted).
const populatedMonths = computed<{ year: number; month: number }[]>(() =>
	years.value.flatMap((y) => y.months.map((m) => ({ year: y.year, month: m.month }))),
);

// Adjacent-month navigation (deep-dive finding, ISS-376): a selected month view
// previously dead-ended in a single "back to all" link — paging chronologically
// meant back → scan the pills → click each time. Now compute the previous and
// next month that actually has posts and link them directly, preserving the
// period query, so a reader browsing old content steps month-to-month. The link
// is omitted when there is no month with content in that direction (the archive
// bounds). monthLabel reuses the same UTC-locale formatting as the index pills.
const prevAdjacent = computed(() => {
	if (month.value == null) return null;
	const idx = populatedMonths.value.findIndex(
		(p) => p.year === year.value && p.month === month.value,
	);
	if (idx < 0 || idx >= populatedMonths.value.length - 1) return null;
	return populatedMonths.value[idx + 1];
});
const nextAdjacent = computed(() => {
	if (month.value == null) return null;
	const idx = populatedMonths.value.findIndex(
		(p) => p.year === year.value && p.month === month.value,
	);
	if (idx <= 0) return null;
	return populatedMonths.value[idx - 1];
});

function adjacentLabel(p: { year: number; month: number } | null): string {
	if (!p) return "";
	return new Date(Date.UTC(p.year, p.month - 1, 1)).toLocaleString(
		locale.value === "zh" ? "zh-CN" : "en-US",
		{ month: "long", year: "numeric" },
	);
}

// Windowed, ellipsis-aware pagination buttons (same pattern as home/search):
// a month with 50+ pages of posts must not render one button per page.
const paginationTokens = computed(() =>
	paginationPages(posts.value?.pagination?.total_pages ?? 0, posts.value?.pagination?.page ?? 1),
);

// Screen-reader page announcement (round 397, same pattern as home): pagination
// swaps the list in place, which is invisible to assistive tech — announce the
// landed page when it changes.
const pageAnnouncement = computed(() =>
	t("common.state.pageAnnounce", { page: posts.value?.pagination?.page ?? page.value }),
);

// A stale/out-of-range page deep link (e.g. /archive?year=2020&month=1&page=999
// after posts were deleted) would otherwise render the "no posts" empty state
// while earlier pages still hold content — clamp back to the last real page
// once pagination is known, preserving the year/month period (home/search
// already do this; deep-dive finding ISS-308). Loop-safe: the clamp target is
// valid by construction, so the refetch settles on total_pages === page.
watch(
	() => posts.value?.pagination,
	(p) => {
		const requested = Number.parseInt(String(route.query.page), 10);
		if (!p || Number.isNaN(requested) || requested < 2) return;
		const last = p.total_pages ?? 1;
		if (requested > last && last >= 1) {
			navigateTo({
				query: {
					...(year.value ? { year: String(year.value) } : {}),
					...(month.value ? { month: String(month.value) } : {}),
					page: String(last),
				},
				replace: true,
			});
		}
	},
);

// Build the archive page's canonical path for a given page: page 1 of the bare
// archive drops stray query, and a selected period stays URL-visible so the
// month view is its own canonical page (never merged onto the index stub —
// deep-dive finding).
function archivePagePath(pg: number): string {
	const parts: string[] = [];
	if (year.value) parts.push(`year=${year.value}`);
	if (month.value) parts.push(`month=${month.value}`);
	if (pg > 1) parts.push(`page=${pg}`);
	return parts.length > 0 ? `/archive?${parts.join("&")}` : "/archive";
}

useSeo(() => ({
	title: hasPeriod.value
		? t("archive.monthTitle", { year: year.value ?? "", month: monthLabel.value })
		: t("archive.title"),
	description: hasPeriod.value
		? t("archive.monthDesc", { year: year.value ?? "", month: monthLabel.value })
		: t("archive.desc"),
	path: hasPeriod.value ? archivePagePath(page.value || 1) : "/archive",
	locale: locale.value,
	pagination: hasPeriod.value
		? {
				page: page.value || 1,
				totalPages: posts.value?.pagination?.total_pages ?? 1,
				pagePath: archivePagePath,
			}
		: undefined,
}));
</script>

<template>
  <div class="max-w-5xl mx-auto">
    <!-- Archive index view (no year/month selected). Gates on the archive
         fetch alone: the index URL never changes on year→month SPA navigation,
         so this branch stays mounted instead of flashing a whole-page skeleton
         the way the combined pending/error did (which also unmounted the
         year/month list mid-refetch). -->
    <div v-if="!hasPeriod">
      <div v-if="archivePending" class="space-y-4" role="status" aria-busy="true">
        <div class="bg-gray-100 animate-pulse h-8 rounded-lg mb-4 w-1/3" />
        <div class="space-y-2">
          <div v-for="i in 6" :key="i" class="bg-gray-100 animate-pulse h-4 rounded w-2/3" />
        </div>
      </div>

      <!-- Index load failed — distinct from "empty": never tell the reader the
           archive has no years when we simply couldn't load it. -->
      <div v-else-if="archiveError" class="text-center py-12" role="alert">
        <p class="text-gray-500 dark:text-gray-400 mb-4">{{ t('common.state.loadFailed') }}</p>
        <button
          type="button"
          class="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          @click="retryArchive"
        >
          {{ t('common.action.retry') }}
        </button>
      </div>

      <div v-else class="space-y-8">
        <div>
          <h1
            class="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent mb-2"
          >
            {{ t('archive.title') }}
          </h1>
          <p class="text-gray-500 dark:text-gray-400">
            {{ t('archive.desc') }}
          </p>
        </div>

        <div
          v-if="years.length"
          class="space-y-6"
        >
          <!-- Narrowing filter (survey finding): matches the tags/categories
               filter the ISS-381 fix added — a long multi-year archive is
               otherwise unscannable. Rendered only when there is something to
               filter. -->
          <div class="relative max-w-sm">
            <Icon icon="lucide:search" class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              v-model="archiveQuery"
              type="search"
              :placeholder="t('archive.searchPlaceholder')"
              :aria-label="t('archive.searchAria')"
              class="w-full pl-10 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 transition-colors"
            >
          </div>
          <p v-if="archiveQuery.trim() && filteredYears.length === 0" class="text-sm text-gray-500 dark:text-gray-400">
            {{ t('archive.noResults') }}
          </p>

          <section
            v-for="y in filteredYears"
            :key="y.year"
          >
            <h2 class="text-xl font-bold text-gray-800 dark:text-gray-100 mb-3">
              {{ y.year }}
            </h2>
            <div class="flex flex-wrap gap-3">
              <NuxtLink
                v-for="m in y.months"
                :key="m.month"
                :to="{ query: { year: String(m.year), month: String(m.month) } }"
                class="px-4 py-2 bg-gradient-to-r from-purple-500 to-indigo-500 text-white rounded-xl text-sm font-medium hover:from-purple-600 hover:to-indigo-600 transition-all shadow-md hover:shadow-lg"
              >
                {{
                  new Date(Date.UTC(m.year, m.month - 1, 1)).toLocaleString(
                    locale === "zh" ? "zh-CN" : "en-US",
                    { month: "long" },
                  )
                }}
                <span class="opacity-80 text-xs">({{ m.count }})</span>
              </NuxtLink>
            </div>
          </section>
        </div>

          <div
            v-else
            class="text-center py-12 text-gray-500"
          >
            {{ t('archive.empty') }}
          </div>
        </div>
    </div>

    <!-- Posts for a selected year/month. Chrome — back link, adjacent-month
         navigation, title, count — stays mounted across year/month SPA
         navigation; only the posts region below reflects pending/error, so a
         period switch refreshes the list without the header flickering away
         (search.vue pattern). -->
    <div v-else>
      <div class="mb-8">
        <div class="flex items-center justify-between gap-3 mb-4">
          <NuxtLink
            to="/archive"
            class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-purple-600 transition-colors"
          >
            <Icon icon="lucide:arrow-left" class="w-4 h-4" />
            {{ t('archive.backToAll') }}
          </NuxtLink>
          <!-- Adjacent-month navigation (ISS-376): the selected-month view used
               to dead-end in "back to all" — step to the previous/next month
               that actually has posts directly, bounded at the archive ends. -->
          <div class="flex items-center gap-2">
            <NuxtLink
              v-if="prevAdjacent"
              :to="{ query: { year: String(prevAdjacent.year), month: String(prevAdjacent.month) } }"
              class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-purple-600 transition-colors"
            >
              <Icon icon="lucide:chevron-left" class="w-4 h-4" />
              {{ adjacentLabel(prevAdjacent) }}
            </NuxtLink>
            <NuxtLink
              v-if="nextAdjacent"
              :to="{ query: { year: String(nextAdjacent.year), month: String(nextAdjacent.month) } }"
              class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-purple-600 transition-colors text-right"
            >
              {{ adjacentLabel(nextAdjacent) }}
              <Icon icon="lucide:chevron-right" class="w-4 h-4" />
            </NuxtLink>
          </div>
        </div>
        <h1 class="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent">
          {{ t('archive.monthTitle', { year: year ?? '', month: monthLabel }) }}
        </h1>
        <p class="text-gray-500 dark:text-gray-400 mt-1">
          {{ t('archive.countLabel', { count: posts?.pagination?.total ?? 0 }) }}
        </p>
      </div>

      <!-- Posts region: only this swaps on pending/error — the chrome above
           stays mounted while a year→month (or page) navigation refetches. -->
      <span role="status" aria-live="polite" class="sr-only">{{ pageAnnouncement }}</span>
      <div v-if="postsPending" class="space-y-4" role="status" aria-busy="true">
        <div class="bg-gray-100 animate-pulse h-8 rounded-lg mb-4 w-1/3" />
        <div class="space-y-2">
          <div v-for="i in 6" :key="i" class="bg-gray-100 animate-pulse h-4 rounded w-2/3" />
        </div>
      </div>

      <!-- Posts load failed — distinct from "empty": never tell the reader this
           period has no posts when we simply couldn't load them. -->
      <div v-else-if="postsError" class="text-center py-12" role="alert">
        <p class="text-gray-500 dark:text-gray-400 mb-4">{{ t('common.state.loadFailed') }}</p>
        <button
          type="button"
          class="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          @click="retryPosts"
        >
          {{ t('common.action.retry') }}
        </button>
      </div>

      <!-- Posts list -->
      <div
        v-else-if="posts?.items?.length"
        class="space-y-6"
      >
        <div
          v-for="post in posts.items"
          :key="post.id"
          class="border border-gray-100 rounded-lg p-6 hover:shadow-md transition-shadow"
        >
          <NuxtLink
            :to="`/posts/${post.slug}`"
            class="text-xl font-bold hover:text-purple-600"
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
            <span v-if="post.category">
              {{ post.category.name }}
            </span>
            <span>
              {{ parseApiDate(effectivePublishTs(post))?.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US") ?? "" }}
            </span>
            <span>{{ t('archive.views', { count: post.views }) }}</span>
          </div>
        </div>

        <!-- Pagination (windowed with ellipsis, matching home/search) -->
        <div
          v-if="posts && posts.pagination.total_pages > 1"
          class="flex items-center justify-center gap-2 mt-8"
        >
          <button
            v-for="(pg, i) in paginationTokens"
            :key="pg === '…' ? `ellipsis-${i}` : pg"
            :disabled="pg === '…' || pg === page"
            :aria-current="pg !== '…' && pg === page ? 'page' : undefined"
            :class="[
              'px-3 py-1 rounded transition-colors',
              pg === '…'
                ? 'cursor-default text-gray-400'
                : pg === page
                  ? 'bg-purple-600 text-white cursor-default'
                  : 'border hover:bg-gray-50',
            ]"
            @click="pg !== '…' && pg !== page && goToPage(pg)"
          >
            {{ pg }}
          </button>
        </div>
      </div>

      <!-- Empty posts -->
      <div
        v-else
        class="text-center py-12 text-gray-500"
      >
        {{ t('archive.postsEmpty') }}
      </div>
    </div>
  </div>
</template>
