<!--
  Admin newsletter subscribers page (DEC-354, TASK-402).

  The operator surface for the guest email newsletter (DEC-351): lists every
  subscribed address with its double opt-in state (confirmed / pending) and
  the subscription date, lets the admin filter by state and search by email,
  and removes an address entirely (row + token). A newsletter with no
  management is operationally broken — an operator cannot see who is on the
  list, how many are confirmed, or remove a subscribed-away address — so this
  page is the management loop that completes the feature.
-->
<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";

import {
	type AdminNewsletterStatus,
	deleteNewsletterSubscriber,
	useAdminNewsletterSubscribers,
} from "~~/api/admin/newsletter";
import { parseApiDate } from "~~/composables/apiDate";

definePageMeta({ layout: "admin" });

const { t, locale } = useLang();

useHead({ title: computed(() => t("admin.newsletter.seoTitle")) });

const currentPage = ref(1);
const pageSize = 20;
const statusFilter = ref<AdminNewsletterStatus>("all");
// Debounced search: the input ref updates instantly, the query ref drives the
// useFetch path so a pause in typing triggers a refetch (DEC-189 pattern).
const searchInput = ref("");
const searchQ = ref("");
let searchTimer: ReturnType<typeof setTimeout> | undefined;
function onSearchInput() {
	clearTimeout(searchTimer);
	searchTimer = setTimeout(() => {
		searchQ.value = searchInput.value;
		currentPage.value = 1;
	}, 300);
}
// A pending debounce must not fire a refetch after the page unmounts (a
// leaked-timer writes to a dead component; known test/failure mode).
onUnmounted(() => clearTimeout(searchTimer));

const { data, pending, error, refresh } = useAdminNewsletterSubscribers(
	currentPage,
	pageSize,
	statusFilter,
	searchQ,
);
// A filter change resets to page 1 (a filter on page 3 would otherwise start
// on an out-of-range page until the operator clicks back).
function setStatus(value: AdminNewsletterStatus) {
	statusFilter.value = value;
	currentPage.value = 1;
}

const items = computed(() => data.value?.items ?? []);
const total = computed(() => data.value?.pagination?.total ?? 0);
const totalPages = computed(() => data.value?.pagination?.total_pages ?? 0);

// Clamped page navigation (same guard as the readers/posts list goToPage).
function goToPage(page: number) {
	if (page < 1 || page > totalPages.value) return;
	currentPage.value = page;
}

// Rows whose delete is in flight, tracked per-row (a single busyId would let a
// second row's delete clear the first row's in-flight marker — the single-slot
// race the readers page guards, on a destructive action).
const busyIds = ref<Set<number>>(new Set());
const actionError = ref<string | null>(null);

function formatDate(value: string | null): string {
	if (!value) return "—";
	const d = parseApiDate(value);
	if (!d) return "—";
	return d.toLocaleDateString(locale.value === "zh" ? "zh-CN" : "en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

async function removeSubscriber(id: number, email: string) {
	if (busyIds.value.has(id)) return; // single-flight per row
	if (!window.confirm(t("admin.newsletter.confirmDelete", { email }))) return;
	let rowGone = true;
	try {
		await deleteNewsletterSubscriber(id);
	} catch (e) {
		// A 404 means the row was already removed — the desired end state is
		// reached, so treat it as a success and refetch rather than erroring
		// about an absent row.
		const status = (e as { response?: { status?: number } } | undefined)?.response?.status;
		if (status !== 404) {
			rowGone = false;
			actionError.value = e instanceof Error ? e.message : t("admin.newsletter.deleteFailed");
		}
	} finally {
		busyIds.value.delete(id);
	}
	if (rowGone) {
		// Refetch so the list reflects the removal (and page count stays sane).
		await refresh();
		if (items.value.length === 0 && currentPage.value > 1) {
			currentPage.value -= 1;
		}
	}
}
</script>

<template>
  <div>
    <header class="mb-6">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t("admin.newsletter.title") }}</h1>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ t("admin.newsletter.description") }}</p>
    </header>

    <div class="mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <input
        v-model="searchInput"
        type="search"
        :placeholder="t('admin.newsletter.searchPlaceholder')"
        :aria-label="t('admin.newsletter.searchPlaceholder')"
        class="w-full sm:max-w-xs px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        @input="onSearchInput"
      />
      <div class="flex items-center gap-1 rounded-xl border border-gray-200 dark:border-gray-700 p-1"
        role="group" :aria-label="t('admin.newsletter.filterLabel')">
        <button
          v-for="s in (['all', 'confirmed', 'pending'] as const)"
          :key="s"
          type="button"
          :aria-pressed="statusFilter === s"
          class="px-3 py-1 text-xs font-medium rounded-lg transition-colors"
          :class="statusFilter === s
            ? 'bg-blue-600 text-white'
            : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'"
          @click="setStatus(s)"
        >
          {{ t(`admin.newsletter.filter.${s}`) }}
        </button>
      </div>
      <p v-if="total > 0" class="text-xs text-gray-500 dark:text-gray-400 sm:ml-auto">
        {{ t("admin.newsletter.total", { count: total }) }}
      </p>
    </div>

    <p v-if="actionError" role="alert" class="mb-4 p-3 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-xl text-sm">
      {{ actionError }}
    </p>
    <div v-if="error" class="mb-4 p-3 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-xl text-sm flex flex-wrap items-center gap-3">
      <p role="alert">{{ t("admin.newsletter.loadFailed") }}</p>
      <button
        type="button"
        class="px-2 py-1 rounded-lg text-xs font-medium border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
        @click="() => refresh()"
      >
        {{ t("common.action.retry") }}
      </button>
    </div>

    <div v-if="pending && items.length === 0" role="status" class="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
      <Icon icon="lucide:loader-2" class="w-5 h-5 animate-spin mx-auto mb-2" />
      {{ t("common.state.loading") }}
    </div>

    <div v-else-if="items.length === 0" class="p-8 text-center text-sm text-gray-500 dark:text-gray-400 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
      {{ statusFilter === "all" ? t("admin.newsletter.empty") : t("admin.newsletter.emptyFilter") }}
    </div>

    <div v-else class="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
            <th class="px-4 py-3">{{ t("admin.newsletter.colEmail") }}</th>
            <th class="px-4 py-3">{{ t("admin.newsletter.colStatus") }}</th>
            <th class="px-4 py-3 hidden sm:table-cell">{{ t("admin.newsletter.colSubscribed") }}</th>
            <th class="px-4 py-3 sm:w-24 sr-only">{{ t("admin.newsletter.colActions") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="sub in items"
            :key="sub.id"
            class="border-b border-gray-100 dark:border-gray-800 last:border-0"
          >
            <td class="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{{ sub.email }}</td>
            <td class="px-4 py-3">
              <span
                class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
                :class="sub.is_confirmed
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                  : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'"
              >
                {{ t(sub.is_confirmed ? "admin.newsletter.status.confirmed" : "admin.newsletter.status.pending") }}
              </span>
            </td>
            <td class="px-4 py-3 text-gray-500 dark:text-gray-400 hidden sm:table-cell">
              {{ formatDate(sub.created_at) }}
            </td>
            <td class="px-4 py-3 text-right">
              <button
                type="button"
                :disabled="busyIds.has(sub.id)"
                :aria-busy="busyIds.has(sub.id)"
                class="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                :aria-label="t('admin.newsletter.deleteAria', { email: sub.email })"
                @click="removeSubscriber(sub.id, sub.email)"
              >
                <Icon v-if="busyIds.has(sub.id)" icon="lucide:loader-2" class="w-3.5 h-3.5 animate-spin" />
                <Icon v-else icon="lucide:trash-2" class="w-3.5 h-3.5" />
                {{ t("admin.newsletter.delete") }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination (guarded prev/next, same as the readers list). -->
    <div v-if="totalPages > 1" class="mt-4 flex items-center justify-center gap-2">
      <button
        type="button"
        :disabled="currentPage <= 1"
        class="px-3 py-1.5 rounded-lg text-sm border border-gray-200 dark:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700"
        @click="goToPage(currentPage - 1)"
      >
        {{ t("common.action.prev") }}
      </button>
      <span class="text-sm text-gray-500 dark:text-gray-400">
        {{ currentPage }} / {{ totalPages }}
      </span>
      <button
        type="button"
        :disabled="currentPage >= totalPages"
        class="px-3 py-1.5 rounded-lg text-sm border border-gray-200 dark:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700"
        @click="goToPage(currentPage + 1)"
      >
        {{ t("common.action.next") }}
      </button>
    </div>
  </div>
</template>
