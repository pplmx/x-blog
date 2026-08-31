<!--
  Admin Editorial Calendar Page (DEC-162, TASK-194).

  A Monday-first month grid that places every post on the day it is live
  (published), goes live (scheduled) or is planned for (draft with an intended
  publish date), plus an undated-drafts sidebar. The month lives in the URL
  query (?month=YYYY-MM) so a given plan is shareable and survives reload;
  each chip deep-links into the post editor. Backend dates are naive UTC
  (utc_now_naive contract); we append 'Z' before parsing so the browser turns
  them into the operator's local wall-clock for the grid (same convention as
  the editor's publish_at round-trip).
-->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
	type AdminCalendarResponse,
	type CalendarPost,
	getAdminCalendar,
} from "~~/api/admin/calendar";

definePageMeta({ layout: "admin" });

const { t, locale } = useLang();
const route = useRoute();

useHead({ title: computed(() => t("admin.calendar.seoTitle")) });

const pad = (n: number) => String(n).padStart(2, "0");

function currentMonthKey(): string {
	const d = new Date();
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

// The visible month, kept in the URL so a plan can be shared/bookmarked.
const monthKey = computed(() => (route.query.month as string) || currentMonthKey());
const year = computed(() => Number.parseInt(monthKey.value.slice(0, 4), 10));
// monthIndex is 0-based for the Date constructor.
const monthIndex = computed(() => {
	const raw = parseInt(monthKey.value.slice(5, 7), 10);
	return Number.isNaN(raw) ? new Date().getMonth() : raw - 1;
});

// 42 cells (6 weeks) so every month shows the same stable 7-col grid.
const gridCells = computed(() => {
	const first = new Date(year.value, monthIndex.value, 1);
	const lead = (first.getDay() + 6) % 7; // Monday-first offset
	const start = new Date(year.value, monthIndex.value, 1 - lead);
	return Array.from({ length: 42 }, (_, i) => {
		const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
		return {
			day: d.getDate(),
			key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
			date: d,
		};
	});
});
const gridRows = computed(() => {
	const rows: (typeof gridCells.value)[] = [];
	for (let i = 0; i < 42; i += 7) rows.push(gridCells.value.slice(i, i + 7));
	return rows;
});
const weekdayLabels = computed(() => {
	const fmt = new Intl.DateTimeFormat(locale.value === "zh" ? "zh-CN" : "en-US", {
		weekday: "short",
	});
	// Start Monday.
	return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2026, 5, 1 + i)));
});
const monthTitle = computed(() =>
	new Date(year.value, monthIndex.value, 1).toLocaleDateString(
		locale.value === "zh" ? "zh-CN" : "en-US",
		{ year: "numeric", month: "long" },
	),
);

const data = ref<AdminCalendarResponse | null>(null);
const loading = ref(false);
const error = ref(false);

// A naive-UTC backend timestamp rendered on the operator's local day.
function parseToLocal(iso: string): Date {
	return new Date(iso && !iso.endsWith("Z") && !iso.includes("+") ? `${iso}Z` : iso);
}

const postsByDay = computed(() => {
	const map: Record<string, CalendarPost[]> = {};
	for (const p of data.value?.items ?? []) {
		if (!p.date) continue;
		const d = parseToLocal(p.date);
		if (Number.isNaN(d.getTime())) continue;
		const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
		const bucket = map[key] ?? [];
		bucket.push(p);
		map[key] = bucket;
	}
	return map;
});

function postsOnDay(dayKey: string): CalendarPost[] {
	return postsByDay.value[dayKey] ?? [];
}
function dayInOtherMonth(key: string): boolean {
	return !key.startsWith(monthKey.value);
}
function isToday(key: string): boolean {
	const d = new Date();
	return key === `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Sequence the loader: rapid next/prev navigation fires several month fetches,
// and without a stale-response guard the OLD month can resolve last and paint
// its posts under the NEW month's header (deep-dive re-audit; mirrors the
// comments page's listRequestSeq).
let calendarRequestSeq = 0;
async function load() {
	const seq = ++calendarRequestSeq;
	loading.value = true;
	error.value = false;
	try {
		const res = await getAdminCalendar(monthKey.value);
		if (seq !== calendarRequestSeq) return; // stale response, drop it
		data.value = res;
	} catch {
		if (seq !== calendarRequestSeq) return;
		data.value = null;
		error.value = true;
	} finally {
		if (seq === calendarRequestSeq) loading.value = false;
	}
}
watch(monthKey, () => void load(), { immediate: true });

function shiftMonth(delta: number) {
	const d = new Date(year.value, monthIndex.value + delta, 1);
	navigateTo({ query: { ...route.query, month: `${d.getFullYear()}-${pad(d.getMonth() + 1)}` } });
}
function goToday() {
	navigateTo({ query: { ...route.query, month: currentMonthKey() } });
}

// One source of truth for chip styling, so legend and cells never drift apart.
function typeSpec(tp: CalendarPost["type"]): { cls: string; labelKey: string } {
	if (tp === "scheduled") {
		return {
			cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
			labelKey: "admin.calendar.legendScheduled",
		};
	}
	if (tp === "published") {
		return {
			cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
			labelKey: "admin.calendar.legendPublished",
		};
	}
	return {
		cls: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
		labelKey: "admin.calendar.legendDraft",
	};
}

// Keep the unscheduled list out of the primary "bottom navigation" test focus.
const unscheduledPosts = computed(() => data.value?.unscheduled ?? []);

// Screen-reader label wiring (ISS-212): the month grid is a data table, not an
// interactive widget — declaring role=grid here would falsely promise arrow-key
// navigation and wouldn't coexist with the post chips' Tab-traversal (ARIA
// authoring practice: use table for non-widget structured content). role=table
// still gives SR users the month name (aria-labelledby) plus a labelled per-day
// cell instead of an unlabeled wall of day numbers.
const monthTitleId = "calendar-month-title";

// Each day cell announces its FULL date (visible "7" gives no month/year) plus
// how many posts sit on it, so the operator hears "Wednesday, July 15, 2026 · 2
// posts" rather than silently more links.
function cellLabel(date: Date, key: string): string {
	const posts = postsOnDay(key);
	const dateText = date.toLocaleDateString(locale.value === "zh" ? "zh-CN" : "en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		weekday: "long",
	});
	if (posts.length === 0) return dateText;
	return `${dateText} · ${t("admin.calendar.postsOnDate", { n: posts.length })}`;
}
</script>

<template>
  <div>
    <div
      class="flex flex-wrap items-center justify-between gap-3 mb-6"
      data-testid="calendar-header"
    >
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Icon icon="lucide:calendar-days" class="w-6 h-6 text-amber-500" />
          {{ t('admin.calendar.title') }}
        </h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {{ t('admin.calendar.desc') }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
          @click="shiftMonth(-1)"
        >
          <Icon icon="lucide:chevron-left" class="w-4 h-4 inline" />
          {{ t('admin.calendar.prevMonth') }}
        </button>
        <button
          type="button"
          class="px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
          @click="goToday"
        >
          {{ t('admin.calendar.today') }}
        </button>
        <button
          type="button"
          class="px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
          @click="shiftMonth(1)"
        >
          {{ t('admin.calendar.nextMonth') }}
          <Icon icon="lucide:chevron-right" class="w-4 h-4 inline" />
        </button>
        <NuxtLink
          to="/admin/posts/new"
          class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-amber-500 text-white hover:bg-amber-600"
        >
          <Icon icon="lucide:plus" class="w-4 h-4" />
          {{ t('admin.calendar.newPost') }}
        </NuxtLink>
      </div>
    </div>

    <div class="grid lg:grid-cols-[1fr_260px] gap-6">
      <div>
        <div class="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
            <h2 :id="monthTitleId" class="text-base font-semibold text-gray-900 dark:text-gray-100">{{ monthTitle }}</h2>
            <div class="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
              <span class="inline-flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>{{ t('admin.calendar.legendPublished') }}</span>
              <span class="inline-flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span>{{ t('admin.calendar.legendScheduled') }}</span>
              <span class="inline-flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-gray-400"></span>{{ t('admin.calendar.legendDraft') }}</span>
            </div>
          </div>
          <div v-if="loading" class="flex items-center gap-2 px-4 py-6 text-sm text-gray-400" role="status">
            <Icon icon="lucide:loader-2" class="w-4 h-4 animate-spin" />
            {{ t('admin.calendar.loading') }}
          </div>

          <!-- A failed month fetch must not masquerade as a genuinely empty month:
               distinct error block with Retry in place of the grid (previously the
               error was a lone reload-only message above a blank grid). -->
          <div v-else-if="error" class="px-4 py-6 text-sm" role="alert">
            <p class="text-red-600 dark:text-red-400 mb-3">{{ t('admin.calendar.loadError') }}</p>
            <button
              type="button"
              class="px-4 py-2 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              @click="load()"
            >
              {{ t('common.action.retry') }}
            </button>
          </div>

          <!-- A labelled data table (ISS-212), not a grid widget: role=table keeps
               the weekday columnheaders and per-day cells meaningful to screen
               readers without falsely promising arrow-key navigation (the post
               chips stay plain Tab-traversable links). -->
          <div v-else role="table" :aria-labelledby="monthTitleId">
            <div role="row" class="grid grid-cols-7 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
              <div
                v-for="w in weekdayLabels"
                :key="w"
                role="columnheader"
                class="px-2 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400"
              >
                {{ w }}
              </div>
            </div>
            <div v-for="row in gridRows" :key="row[0].key" role="row" class="grid grid-cols-7">
              <div
                v-for="cell in row"
                :key="cell.key"
                role="cell"
                :aria-label="cellLabel(cell.date, cell.key)"
                :data-date="cell.key"
                data-testid="calendar-day"
                class="min-h-[72px] border-b border-r border-gray-100 dark:border-gray-800 p-1.5"
                :class="[
                  dayInOtherMonth(cell.key) ? 'bg-gray-50 dark:bg-gray-950/40' : 'bg-white dark:bg-gray-900',
                  isToday(cell.key) ? 'ring-2 ring-inset ring-amber-400' : '',
                ]"
              >
                <div
                  class="flex items-center justify-between text-xs"
                  :class="isToday(cell.key) ? 'font-bold text-amber-600 dark:text-amber-400' : (dayInOtherMonth(cell.key) ? 'text-gray-300 dark:text-gray-700' : 'text-gray-500 dark:text-gray-400')"
                >
                  <span>{{ cell.day }}</span>
                </div>
                <div class="mt-1.5 space-y-1">
                  <a
                    v-for="p in postsOnDay(cell.key)"
                    :key="p.id"
                    :href="`/admin/posts/${p.id}`"
                    class="block truncate rounded px-1.5 py-0.5 text-[11px] leading-4 font-medium hover:opacity-80"
                    :class="typeSpec(p.type).cls"
                    :title="p.title"
                    data-testid="calendar-post-chip"
                  >
                    {{ p.title }}
                  </a>
                  <p v-if="postsOnDay(cell.key).length === 0" class="text-[10px] text-gray-300 dark:text-gray-700">
                    {{ t('admin.calendar.emptyDay') }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <aside class="rounded-xl border border-gray-200 dark:border-gray-800 p-4 h-fit">
        <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
          <Icon icon="lucide:file-pen" class="w-4 h-4 text-gray-400" />
          {{ t('admin.calendar.unscheduled') }}
        </h2>
        <p v-if="loading" class="text-sm text-gray-400">{{ t('admin.calendar.loading') }}</p>
        <!-- On a failed month fetch neither "loading" nor "no unscheduled posts"
             are true — say so instead of lying empty. -->
        <p v-else-if="error" class="text-sm text-gray-400" role="status">{{ t('admin.calendar.loadError') }}</p>
        <p v-else-if="unscheduledPosts.length === 0" class="text-sm text-gray-400">
          {{ t('admin.calendar.unscheduledEmpty') }}
        </p>
        <ul v-else class="space-y-2">
          <li v-for="p in unscheduledPosts" :key="p.id">
            <a
              :href="`/admin/posts/${p.id}`"
              class="block truncate text-sm text-gray-700 dark:text-gray-300 hover:text-amber-600 dark:hover:text-amber-400"
              :title="p.title"
            >
              {{ p.title }}
            </a>
          </li>
        </ul>
      </aside>
    </div>
  </div>
</template>
