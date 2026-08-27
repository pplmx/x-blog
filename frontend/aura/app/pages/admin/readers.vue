<!--
  Admin readers page — the operator surface for registered reader accounts
  (DEC-194, TASK-214, ISS-116). Lists every self-registered reader with their
  moderation-relevant context (join date, last login, comment/bookmark counts)
  and lets the admin deactivate or reactivate an account. Deactivation blocks
  sign-in and revokes every live reader JWT, so a spam reader stops getting
  trust-tier auto-approved comments (DEC-098) immediately.
-->
<script setup lang="ts">
import { activateReader, deactivateReader, useAdminReaders } from "~~/api/admin/readers";
import type { AdminReader } from "~~/api/contracts/reader";

definePageMeta({ layout: "admin" });

const { t, locale } = useLang();

useHead({ title: computed(() => t("admin.readers.seoTitle")) });

const currentPage = ref(1);
const pageSize = 20;
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

const { data, pending, error, refresh } = await useAdminReaders(currentPage, pageSize, searchQ);
const items = computed(() => data.value?.items ?? []);
const total = computed(() => data.value?.pagination?.total ?? 0);
const totalPages = computed(() => data.value?.pagination?.total_pages ?? 0);

const busyId = ref<number | null>(null);
const actionError = ref<string | null>(null);

function formatDate(value: string | null): string {
	if (!value) return "—";
	const d = new Date(value);
	if (Number.isNaN(d.getTime())) return "—";
	return d.toLocaleDateString(locale.value === "zh" ? "zh-CN" : "en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

async function toggleActive(reader: AdminReader) {
	const deactivating = reader.is_active;
	const key = deactivating ? "admin.readers.confirmDeactivate" : "admin.readers.confirmActivate";
	if (!window.confirm(t(key, { email: reader.email }))) return;
	busyId.value = reader.id;
	actionError.value = null;
	try {
		const status = deactivating
			? await deactivateReader(reader.id)
			: await activateReader(reader.id);
		// Patch the row in place with the authoritative server state.
		const row = items.value.find((r) => r.id === status.id);
		if (row) row.is_active = status.is_active;
	} catch (e) {
		actionError.value = e instanceof Error ? e.message : t("admin.readers.toggleFailed");
	} finally {
		busyId.value = null;
	}
}
</script>

<template>
  <div>
    <header class="mb-6">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t("admin.readers.title") }}</h1>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ t("admin.readers.description") }}</p>
    </header>

    <div class="mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <input
        v-model="searchInput"
        type="search"
        :placeholder="t('admin.readers.searchPlaceholder')"
        class="w-full sm:max-w-xs px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        @input="onSearchInput"
      />
      <p v-if="total > 0" class="text-xs text-gray-500 dark:text-gray-400 sm:ml-auto">
        {{ t("admin.readers.total", { count: total }) }}
      </p>
    </div>

    <p v-if="actionError" class="mb-4 p-3 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-xl text-sm">
      {{ actionError }}
    </p>
    <p v-if="error" class="mb-4 p-3 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-xl text-sm">
      {{ t("admin.readers.loadFailed") }}
    </p>

    <div class="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
            <th class="px-4 py-3">{{ t("admin.readers.colEmail") }}</th>
            <th class="hidden md:table-cell px-4 py-3">{{ t("admin.readers.colDisplayName") }}</th>
            <th class="hidden sm:table-cell px-4 py-3">{{ t("admin.readers.colJoined") }}</th>
            <th class="hidden lg:table-cell px-4 py-3">{{ t("admin.readers.colLastLogin") }}</th>
            <th class="px-4 py-3 text-center">{{ t("admin.readers.colComments") }}</th>
            <th class="hidden md:table-cell px-4 py-3 text-center">{{ t("admin.readers.colBookmarks") }}</th>
            <th class="px-4 py-3">{{ t("admin.readers.colStatus") }}</th>
            <th class="px-4 py-3 text-right">{{ t("admin.readers.colAction") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="reader in items"
            :key="reader.id"
            class="border-b border-gray-100 dark:border-gray-700/60 last:border-0"
          >
            <td class="px-4 py-3 text-gray-900 dark:text-gray-100">{{ reader.email }}</td>
            <td class="hidden md:table-cell px-4 py-3 text-gray-600 dark:text-gray-300">
              {{ reader.display_name || "—" }}
            </td>
            <td class="hidden sm:table-cell px-4 py-3 text-gray-500 dark:text-gray-400">
              {{ formatDate(reader.created_at) }}
            </td>
            <td class="hidden lg:table-cell px-4 py-3 text-gray-500 dark:text-gray-400">
              {{ formatDate(reader.last_login_at) }}
            </td>
            <td class="px-4 py-3 text-center text-gray-600 dark:text-gray-300">{{ reader.comment_count }}</td>
            <td class="hidden md:table-cell px-4 py-3 text-center text-gray-600 dark:text-gray-300">
              {{ reader.bookmark_count }}
            </td>
            <td class="px-4 py-3">
              <span
                class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
                :class="
                  reader.is_active
                    ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                    : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                "
              >
                {{ t(reader.is_active ? "admin.readers.statusActive" : "admin.readers.statusDeactivated") }}
              </span>
            </td>
            <td class="px-4 py-3 text-right">
              <button
                type="button"
                :disabled="busyId === reader.id"
                class="text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                :class="
                  reader.is_active
                    ? 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50'
                    : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/50'
                "
                @click="toggleActive(reader)"
              >
                {{
                  busyId === reader.id
                    ? t("admin.readers.pending")
                    : t(reader.is_active ? "admin.readers.deactivate" : "admin.readers.activate")
                }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div
        v-if="!pending && items.length === 0"
        class="px-4 py-12 text-center text-sm text-gray-500 dark:text-gray-400"
      >
        {{ t("admin.readers.empty") }}
      </div>
    </div>

    <div v-if="totalPages > 1" class="mt-4 flex items-center justify-end gap-2">
      <button
        type="button"
        :disabled="currentPage <= 1"
        class="px-3 py-1.5 text-sm rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-40 transition-colors"
        @click="currentPage--"
      >
        {{ t("admin.readers.prevPage") }}
      </button>
      <span class="text-sm text-gray-500 dark:text-gray-400">
        {{ t("admin.readers.pageOf", { page: currentPage, total: totalPages }) }}
      </span>
      <button
        type="button"
        :disabled="currentPage >= totalPages"
        class="px-3 py-1.5 text-sm rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-40 transition-colors"
        @click="currentPage++"
      >
        {{ t("admin.readers.nextPage") }}
      </button>
    </div>
  </div>
</template>
