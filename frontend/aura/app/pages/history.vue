<script setup lang="ts">
/**
 * Reader reading-history page (DEC-114, TASK-169; DEC-116, TASK-170).
 *
 * Lists the reader's recently-viewed posts newest-first with continue-reading
 * links, viewed timestamps, a single clear-history action, and an empty state.
 * The source follows the reader: a signed-in reader gets the server-backed
 * history (synced across devices); guests use the client-side localStorage
 * trail (see composables/useReadingHistory).
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { parseApiDate } from "~~/composables/apiDate";
import { type HistoryEntry, useReadingHistory } from "~~/composables/useReadingHistory";
import { useSeo } from "~~/composables/useSeo";

const { t, locale } = useLang();
const {
	history,
	stats,
	loading,
	loadFailed,
	hasMore,
	loadingMore,
	loadMoreError,
	load,
	loadMore,
	clear,
} = useReadingHistory();

// Recall search (DEC-148/TASK-186): filter history to viewed posts matching
// the term (server for signed-in readers, in-place for guests).
const searchQuery = ref("");
// Debounce recall-search so fast typing doesn't fire a server call per
// keystroke (the seq guard in load() drops out-of-order responses, ISS-128).
let searchTimer: ReturnType<typeof setTimeout> | null = null;
function onSearch() {
	if (searchTimer) clearTimeout(searchTimer);
	searchTimer = setTimeout(() => void load(searchQuery.value), 300);
}
// Clear the pending debounce on unmount so a delayed recall-search can't fire
// against an unmounted component after the reader left (wasted server call).
onUnmounted(() => {
	if (searchTimer) {
		clearTimeout(searchTimer);
		searchTimer = null;
	}
	if (clearedTimer) {
		clearTimeout(clearedTimer);
		clearedTimer = null;
	}
});

useSeo({
	title: t("history.seoTitle"),
	description: t("history.seoDesc"),
	path: "/history",
});

// Load from the active source (server when signed in, else local).
onMounted(() => {
	void load();
});

// Single-action clear with an inline confirmation (destructive, no undo).
const confirmClear = ref(false);
// Transient success confirmation — the empty state after clearing is ambiguous
// (it looks identical to "you've never read anything"), so say what happened
// (deep-dive finding; the clearDone key existed but was never rendered).
const cleared = ref(false);
let clearedTimer: ReturnType<typeof setTimeout> | null = null;

async function clearHistory() {
	await clear();
	confirmClear.value = false;
	cleared.value = true;
	if (clearedTimer) clearTimeout(clearedTimer);
	clearedTimer = setTimeout(() => {
		cleared.value = false;
	}, 4000);
}

// Absolute viewed date, localized. Legacy entries without a timestamp fall
// back to a "recently viewed" label.
function viewedLabel(item: HistoryEntry): string {
	if (!item.viewedAt) return t("history.unviewed");
	const d = parseApiDate(item.viewedAt);
	if (!d) return t("history.unviewed");
	const fmt = new Intl.DateTimeFormat(locale.value === "zh" ? "zh-CN" : "en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
	return fmt.format(d);
}

// Latest-activity card (DEC-165/TASK-197): the server summary carries
// lastViewedAt, which was loaded into stats but never rendered — surface it
// as an absolute localized date-time (same shape as viewedLabel).
function lastActivityLabel(): string {
	if (!stats.value?.lastViewedAt) return t("history.noActivity");
	const d = parseApiDate(stats.value.lastViewedAt);
	if (!d) return t("history.noActivity");
	const fmt = new Intl.DateTimeFormat(locale.value === "zh" ? "zh-CN" : "en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
	return fmt.format(d);
}

// Reading gamification (DEC-169/TASK-201): a GitHub-style activity heatmap of
// the last 52 weeks plus the current/longest reading streak. The server sends
// ascending UTC per-day counts (zeros included); we align the first column to
// a Monday and render week columns of 7 day-cells, shaded by read-count
// intensity (relative to the busiest day in the window).

interface ActivityCell {
	date: string;
	count: number;
}

const ACTIVITY_DAYS = 364;

/** Busiest day's count in the window (>= 1 so single-read days still shade). */
const maxActivity = computed(() =>
	Math.max(1, ...(stats.value?.activity ?? []).map((a) => a.count)),
);

/** Week columns (Monday-first) of cells; null pads the leading partial week. */
const heatmapWeeks = computed<(ActivityCell | null)[][]>(() => {
	const acts = stats.value?.activity ?? [];
	if (!acts.length) return [];
	// The server's first entry may not fall on a Monday; pad the front so
	// columns align and today sits at the end (acts are ascending, end today).
	// acts.length > 0 is checked above; the optional read keeps
	// noUncheckedIndexedAccess quiet without a non-null assertion.
	const firstDate = acts[0]?.date;
	if (!firstDate) return [];
	const mondayIndex = (new Date(`${firstDate}T00:00:00Z`).getUTCDay() + 6) % 7;
	const cells: (ActivityCell | null)[] = [];
	for (let i = 0; i < mondayIndex; i++) cells.push(null);
	for (const a of acts) cells.push(a);
	const weeks: (ActivityCell | null)[][] = [];
	for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
	return weeks;
});

/** Shade a heatmap cell by relative read-count intensity that day. */
function heatCellClass(cell: ActivityCell | null): string {
	if (!cell || cell.count === 0) return "bg-gray-100 dark:bg-gray-800";
	const pct = cell.count / maxActivity.value;
	if (pct < 0.25) return "bg-blue-200 dark:bg-blue-900";
	if (pct < 0.5) return "bg-blue-400 dark:bg-blue-700";
	if (pct < 0.75) return "bg-indigo-500 dark:bg-indigo-600";
	return "bg-violet-600 dark:bg-violet-500";
}

/** Count label shown in a heatmap cell tooltip. */
function heatCellLabel(cell: ActivityCell | null): string {
	if (!cell) return "";
	const d = new Date(`${cell.date}T00:00:00Z`);
	const fmt = new Intl.DateTimeFormat(locale.value === "zh" ? "zh-CN" : "en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
	const posts = t("history.activityPosts", { count: cell.count });
	// Locale-appropriate separator (no hardcoded full-width colon in English, ISS-136).
	const sep = locale.value === "zh" ? "：" : " — ";
	return `${fmt.format(d)}${sep}${posts}`;
}

/** Accessible summary for the whole heatmap; the individual cells are
 * aria-hidden/presentational because 364 per-day labels would be noise (ISS-136). */
function heatMapSummary(): string {
	const activeDays = heatmapWeeks.value.flat().filter((c) => c !== null && c.count > 0).length;
	return t("history.activitySummary", { count: activeDays });
}
</script>

<template>
  <div class="max-w-4xl mx-auto">
    <div class="flex flex-wrap items-center justify-between gap-4 mb-8">
      <div>
        <h1 class="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Icon icon="lucide:history" class="w-7 h-7 text-violet-500" />
          {{ t('history.title') }}
        </h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {{ t('history.seoDesc') }}
        </p>
      </div>
      <button
        v-if="history.length || loading"
        type="button"
        class="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-red-500 dark:hover:text-red-400 transition-colors"
        @click="confirmClear = true"
      >
        <Icon icon="lucide:trash-2" class="w-4 h-4" />
        {{ t('history.clear') }}
      </button>
    </div>

    <!-- Recall search (DEC-148/TASK-186): find a past read -->
    <div class="mb-8">
      <div class="relative max-w-md">
        <Icon icon="lucide:search" class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          v-model="searchQuery"
          type="search"
          :placeholder="t('history.searchPlaceholder')"
          :aria-label="t('history.searchAria')"
          class="w-full pl-10 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500 transition-colors"
          @input="onSearch"
        >
      </div>
      <p v-if="searchQuery.trim() && history.length === 0 && !loading" class="mt-2 text-sm text-gray-500">
        {{ t('history.noSearchResults') }}
      </p>
    </div>

    <!-- Reading summary (server-backed, signed-in readers only) -->
    <div
      v-if="stats"
      class="mb-8"
    >
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div class="p-5 rounded-2xl border border-gray-100 dark:border-gray-800 bg-gradient-to-br from-violet-50 to-transparent dark:from-violet-900/20">
          <p class="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">{{ t('history.postsRead') }}</p>
          <p class="text-3xl font-bold text-gray-900 dark:text-gray-100">{{ stats.totalPosts }}</p>
        </div>
        <div class="p-5 rounded-2xl border border-gray-100 dark:border-gray-800 bg-gradient-to-br from-blue-50 to-transparent dark:from-blue-900/20">
          <p class="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">{{ t('history.readingMinutes') }}</p>
          <p class="text-3xl font-bold text-gray-900 dark:text-gray-100">{{ stats.totalReadingMinutes }}</p>
        </div>
        <div class="p-5 rounded-2xl border border-gray-100 dark:border-gray-800 bg-gradient-to-br from-emerald-50 to-transparent dark:from-emerald-900/20">
          <p class="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">{{ t('history.lastActivity') }}</p>
          <p class="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 leading-snug">{{ lastActivityLabel() }}</p>
        </div>
        <div class="p-5 rounded-2xl border border-gray-100 dark:border-gray-800 bg-gradient-to-br from-amber-50 to-transparent dark:from-amber-900/20">
          <p class="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">{{ t('history.currentStreak') }}</p>
          <p class="text-3xl font-bold text-gray-900 dark:text-gray-100">
            {{ stats.currentStreak ?? 0 }}
            <span class="text-base font-medium text-gray-400 dark:text-gray-500 ml-1">{{ t('history.days') }}</span>
          </p>
          <p class="text-xs font-medium text-gray-400 dark:text-gray-500 mt-1">
            {{ t('history.longestStreak', { count: stats.longestStreak ?? 0 }) }}
          </p>
        </div>
      </div>

      <!-- 52-week activity heatmap (DEC-169/TASK-201) -->
      <div
        v-if="heatmapWeeks.length"
        class="p-5 rounded-2xl border border-gray-100 dark:border-gray-800 bg-gradient-to-br from-blue-50/60 to-transparent dark:from-blue-900/15"
      >
        <p class="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">{{ t('history.activityTitle') }}</p>
        <div class="overflow-x-auto pb-1">
          <div
            role="img"
            :aria-label="heatMapSummary()"
            class="grid grid-flow-col auto-cols-[11px] gap-[3px] w-fit"
            style="grid-template-rows: repeat(7, 11px)"
          >
            <template v-for="(week, wi) in heatmapWeeks" :key="wi">
              <div
                v-for="(cell, ci) in week"
                :key="ci"
                class="h-[11px] w-[11px] rounded-[2px]"
                :class="heatCellClass(cell)"
                :title="heatCellLabel(cell)"
                aria-hidden="true"
              />
            </template>
          </div>
        </div>
        <div class="mt-2 flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
          <span class="mr-1">{{ t('history.less') }}</span>
          <span class="h-[11px] w-[11px] rounded-[2px] bg-gray-100 dark:bg-gray-800" />
          <span class="h-[11px] w-[11px] rounded-[2px] bg-blue-200 dark:bg-blue-900" />
          <span class="h-[11px] w-[11px] rounded-[2px] bg-blue-400 dark:bg-blue-700" />
          <span class="h-[11px] w-[11px] rounded-[2px] bg-indigo-500 dark:bg-indigo-600" />
          <span class="h-[11px] w-[11px] rounded-[2px] bg-violet-600 dark:bg-violet-500" />
          <span class="ml-1">{{ t('history.more') }}</span>
        </div>
      </div>
    </div>

    <!-- Inline clear confirmation -->
    <div
      v-if="confirmClear"
      class="mb-6 flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-red-200 dark:border-red-800 bg-red-50/60 dark:bg-red-900/20"
      role="alert"
    >
      <p class="text-sm text-red-700 dark:text-red-300">{{ t('history.clearConfirm') }}</p>
      <div class="flex gap-3">
        <button
          type="button"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-500 hover:bg-red-600 transition-colors"
          @click="clearHistory"
        >
          <Icon icon="lucide:trash-2" class="w-4 h-4" />
          {{ t('history.clearConfirmAction') }}
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          @click="confirmClear = false"
        >
          {{ t('common.action.cancel') }}
        </button>
      </div>
    </div>

    <!-- Clear-done confirmation (deep-dive finding): give the destructive,
         non-undoable clear an explicit success signal instead of silently
         swapping to the ambiguous empty state. -->
    <div
      v-if="cleared"
      aria-live="polite"
      class="mb-6 flex items-center justify-between gap-4 p-4 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/20"
    >
      <p class="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
        <Icon icon="lucide:check-circle-2" class="w-4 h-4" />
        {{ t('history.clearDone') }}
      </p>
    </div>

    <!-- Server-load failure: a transient failure offers a labeled local-trail
         fallback + retry instead of a misleading "no reading history yet" empty
         state (a multi-device reader's local trail is often empty, deep-dive). -->
    <div
      v-if="loadFailed && !loading"
      role="alert"
      class="mb-6 flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/20"
    >
      <p class="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
        <Icon icon="lucide:triangle-alert" class="w-4 h-4 shrink-0" />
        {{ t('history.loadFailedFallback') }}
      </p>
      <button
        type="button"
        class="px-3 py-1.5 rounded-lg text-xs font-medium border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
        @click="load(searchQuery)"
      >
        {{ t('common.action.retry') }}
      </button>
    </div>

    <!-- Empty state: only when history is genuinely empty (and the load did not
         fail — fallback rows may legitimately be empty). A recall-search that
         matches nothing shows the small "no results" hint above instead — never
         both (that claimed the reader has no history AND prompted them to browse). -->
    <div v-if="!loading && !loadFailed && !history.length && !searchQuery.trim()" class="text-center py-20">
      <Icon icon="lucide:history" class="w-14 h-14 mx-auto mb-5 text-gray-300 dark:text-gray-600" />
      <p class="font-medium text-gray-700 dark:text-gray-200 mb-2">{{ t('history.empty') }}</p>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-7">{{ t('history.emptyDesc') }}</p>
      <NuxtLink
        to="/"
        class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 transition-all shadow-md hover:shadow-lg"
      >
        <Icon icon="lucide:book-open" class="w-4 h-4" />
        {{ t('history.browse') }}
      </NuxtLink>
    </div>

    <!-- History list -->
    <div v-else class="space-y-3">
      <!-- Loading feedback: skeletons on first load (no rows yet) so the page
           doesn't look dead; a spinner above stale rows during a recall search
           so the in-flight swap is not silent (deep-dive finding). -->
      <template v-if="loading && !history.length">
        <div v-for="i in 4" :key="i" class="bg-gray-100 dark:bg-gray-800 animate-pulse h-20 rounded-2xl" />
      </template>
      <p v-else-if="loading" class="flex items-center justify-center gap-2 py-4 text-sm text-gray-400" role="status">
        <Icon icon="lucide:loader-2" class="w-4 h-4 animate-spin" />
        {{ t('history.loading') }}
      </p>
      <NuxtLink
        v-for="item in history"
        :key="item.slug"
        :to="`/posts/${item.slug}`"
        class="group flex items-center gap-4 p-4 rounded-2xl border border-gray-100 dark:border-gray-800 hover:border-violet-200 dark:hover:border-violet-800 hover:shadow-md transition-all duration-200"
      >
        <span class="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-900/30 text-violet-500">
          <Icon icon="lucide:book-open" class="w-5 h-5" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate font-medium text-gray-900 dark:text-gray-100 group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
            {{ item.title }}
          </p>
          <p class="mt-0.5 flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
            <Icon icon="lucide:clock" class="w-3.5 h-3.5" />
            <span class="inline-flex items-center gap-1">
              {{ viewedLabel(item) }}
              <span aria-hidden="true">·</span>
              {{ t('history.continue') }}
            </span>
          </p>
        </div>
        <Icon icon="lucide:chevron-right" class="w-5 h-5 text-gray-300 dark:text-gray-600 group-hover:text-violet-400 transition-colors shrink-0" />
      </NuxtLink>

      <!-- Load-more (bounded reachability, ISS-303): the server returns at most
           100 rows per page, so older history must not be trapped behind the
           first page. A failure keeps the rows and offers retry. -->
      <div v-if="hasMore" class="mt-6 flex flex-col items-center gap-2">
        <button
          type="button"
          :disabled="loadingMore"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          @click="loadMore"
        >
          <Icon v-if="loadingMore" icon="lucide:loader-2" class="w-4 h-4 animate-spin" aria-hidden="true" role="presentation" />
          {{ loadingMore ? t('history.loading') : t('history.loadMore') }}
        </button>
        <p v-if="loadMoreError" class="text-sm text-red-600 dark:text-red-400">
          {{ t('common.errors.network') }}
        </p>
      </div>
    </div>
  </div>
</template>
