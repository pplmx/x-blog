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
	fetchAdminCalendar,
} from "~~/composables/useApi";

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

async function load() {
	loading.value = true;
	error.value = false;
	try {
		data.value = await fetchAdminCalendar(monthKey.value);
	} catch {
		data.value = null;
		error.value = true;
	} finally {
		loading.value = false;
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

    <p v-if="error" class="mb-4 text-sm text-red-600 dark:text-red-400">
      {{ t('admin.calendar.loadError') }}
    </p>

    <div class="grid lg:grid-cols-[1fr_260px] gap-6">
      <div>
        <div class="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
            <h2 class="text-base font-semibold text-gray-900 dark:text-gray-100">{{ monthTitle }}</h2>
            <div class="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
              <span class="inline-flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>{{ t('admin.calendar.legendPublished') }}</span>
              <span class="inline-flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span>{{ t('admin.calendar.legendScheduled') }}</span>
              <span class="inline-flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-gray-400"></span>{{ t('admin.calendar.legendDraft') }}</span>
            </div>
          </div>
          <div class="grid grid-cols-7 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
            <div
              v-for="w in weekdayLabels"
              :key="w"
              class="px-2 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400"
            >
              {{ w }}
            </div>
          </div>

          <div class="grid grid-cols-7">
            <template v-for="cell in gridCells" :key="cell.key">
              <div
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
                  <p v-if="postsOnDay(cell.key).length === 0 && !loading" class="text-[10px] text-gray-300 dark:text-gray-700">
                    {{ t('admin.calendar.emptyDay') }}
                  </p>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>

      <aside class="rounded-xl border border-gray-200 dark:border-gray-800 p-4 h-fit">
        <h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
          <Icon icon="lucide:file-pen" class="w-4 h-4 text-gray-400" />
          {{ t('admin.calendar.unscheduled') }}
        </h2>
        <p v-if="loading" class="text-sm text-gray-400">{{ t('admin.calendar.loading') }}</p>
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
