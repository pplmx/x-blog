<!--
  Admin Media Library (DEC-183) — grid of every uploaded image.
  Browse (newest first), search by filename (DEC-189), copy URL to paste into a
  post, and delete images that are not referenced by any post — singly or in a
  multi-select batch (DEC-191). Filesystem-backed: the listing comes from the
  backend media API which walks static/uploads/ and reports reference status
  from one scan of post content + cover_image.
-->
<script setup lang="ts">
import {
	batchDeleteAdminMediaFiles,
	deleteAdminMediaFile,
	useAdminMedia,
} from "~~/api/admin/media";
import type { UploadFileInfo } from "~~/api/contracts/media";
import { parseApiDate } from "~~/composables/apiDate";

definePageMeta({ layout: "admin" });

const { t } = useLang();

useHead({ title: computed(() => t("admin.media.seoTitle")) });

const currentPage = ref(1);
const pageSize = 60;
// Debounced filename search: the input ref updates instantly, the query ref
// settles 300ms after the last keystroke so each keystroke doesn't fire a
// request. Both refs feed the computed listing path (DEC-189).
const searchInput = ref("");
const searchQ = ref("");
const q = computed(() => searchQ.value);
let searchTimer: ReturnType<typeof setTimeout> | undefined;
function onSearchInput() {
	clearTimeout(searchTimer);
	searchTimer = setTimeout(() => {
		searchQ.value = searchInput.value;
		currentPage.value = 1; // a new filter starts from the first page
	}, 300);
}

const { data, pending, error, refresh } = await useAdminMedia(currentPage, pageSize, searchQ);
const items = computed(() => data.value?.items ?? []);
const total = computed(() => data.value?.pagination?.total ?? 0);
const totalPages = computed(() => data.value?.pagination?.total_pages ?? 0);

const isDeleting = ref(false);
const actionError = ref<string | null>(null);
const copiedUrl = ref<string | null>(null);

// Bulk-delete selection (DEC-191): the URLs of the deletable cards the admin
// has ticked. Only unreferenced images get a checkbox (referenced ones are
// undeletable, so they are never selectable); the selection resets on page or
// search change so a ticked card can't be silently swept into a later batch.
const selected = ref<string[]>([]);
const selectedCount = computed(() => selected.value.length);
function isSelected(item: UploadFileInfo): boolean {
	return selected.value.includes(item.url);
}
function toggleSelect(item: UploadFileInfo) {
	selected.value = selected.value.includes(item.url)
		? selected.value.filter((u) => u !== item.url)
		: [...selected.value, item.url];
}
watch([currentPage, searchQ], () => {
	selected.value = [];
});

const batchDeleting = ref(false);
async function handleBatchDelete() {
	if (selectedCount.value === 0 || batchDeleting.value) return;
	if (!confirm(t("admin.media.confirmBatchDelete", { n: selectedCount.value }))) return;
	batchDeleting.value = true;
	actionError.value = null;
	try {
		await batchDeleteAdminMediaFiles([...selected.value]);
		selected.value = [];
		await refresh();
		// Deleting the last item of the last page strands on an out-of-range
		// page showing a false "empty" — clamping currentPage re-runs the
		// reactive listing path (deep-dive re-audit).
		if (currentPage.value > totalPages.value && totalPages.value >= 1) {
			currentPage.value = totalPages.value;
		}
	} catch (e) {
		actionError.value = e instanceof Error ? e.message : t("admin.media.deleteFailed");
	} finally {
		batchDeleting.value = false;
	}
}

function imageUrl(item: UploadFileInfo): string {
	const config = useRuntimeConfig();
	return `${config.public.apiUrl}${item.url}`;
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function copyUrl(item: UploadFileInfo) {
	try {
		await navigator.clipboard.writeText(item.url);
		copiedUrl.value = item.url;
		setTimeout(() => {
			if (copiedUrl.value === item.url) copiedUrl.value = null;
		}, 1500);
	} catch {
		// Clipboard API can be unavailable (non-secure context); fall back to
		// selecting the URL in an input so the author can copy manually.
		const fallback = document.createElement("input");
		fallback.value = item.url;
		document.body.appendChild(fallback);
		fallback.select();
		document.execCommand("copy");
		document.body.removeChild(fallback);
		copiedUrl.value = item.url;
		setTimeout(() => {
			if (copiedUrl.value === item.url) copiedUrl.value = null;
		}, 1500);
	}
}

async function handleDelete(item: UploadFileInfo) {
	if (!confirm(t("admin.media.confirmDelete"))) return;
	isDeleting.value = true;
	actionError.value = null;
	try {
		await deleteAdminMediaFile(item);
		await refresh();
		// Clamp an out-of-range page after deleting the last item of the last
		// page (see handleBatchDelete); currentPage change re-fetches.
		if (currentPage.value > totalPages.value && totalPages.value >= 1) {
			currentPage.value = totalPages.value;
		}
	} catch (e) {
		actionError.value = e instanceof Error ? e.message : t("admin.media.deleteFailed");
	} finally {
		isDeleting.value = false;
	}
}

function goToPage(page: number) {
	if (page < 1 || page > totalPages.value) return;
	// Setting currentPage re-runs the computed listing path (useFetch watches
	// it), so there's no manual refresh here — a click refetches automatically.
	currentPage.value = page;
}
</script>

<template>
  <div>
    <div class="mb-8">
      <h1
        class="text-2xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent"
      >
        {{ t("admin.media.title") }}
      </h1>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t("admin.media.summary", { n: total }) }}</p>
    </div>

    <div class="mb-4 flex flex-wrap items-center gap-3">
      <div class="max-w-sm flex-1 min-w-56">
        <input
          v-model="searchInput"
          type="search"
          :placeholder="t('admin.media.searchPlaceholder')"
          class="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          @input="onSearchInput"
        >
      </div>
      <div v-if="selectedCount > 0" class="flex items-center gap-2">
        <span class="text-sm text-gray-600 dark:text-gray-300">
          {{ t("admin.media.selectedCount", { n: selectedCount }) }}
        </span>
        <button
          type="button"
          :disabled="batchDeleting"
          class="px-3 py-2 text-sm rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
          @click="handleBatchDelete"
        >
          {{ t("admin.media.deleteSelected") }}
        </button>
      </div>
    </div>

    <div v-if="actionError" role="alert" class="mb-4 p-3 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-xl text-sm">
      {{ actionError }}
    </div>

    <!-- pending / error / empty / grid are one mutually-exclusive chain: a failed
         fetch must never render alongside the empty state ("Failed to load media"
         + "No uploads yet" was the pre-fix double render), and it gets a Retry
         affordance instead of being a reload-only dead end. -->
    <div v-if="pending" class="py-16 text-center text-gray-500 dark:text-gray-400 text-sm" role="status">
      {{ t("admin.media.loading") }}
    </div>

    <div v-else-if="error" class="py-16 text-center" role="alert">
      <Icon icon="lucide:alert-circle" class="w-12 h-12 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
      <p class="mb-4 text-sm text-red-600 dark:text-red-400">{{ t("admin.media.loadFailed") }}</p>
      <button
        type="button"
        class="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        @click="refresh()"
      >
        {{ t("common.action.retry") }}
      </button>
    </div>

    <div v-else-if="items.length === 0" class="py-16 text-center">
      <Icon icon="lucide:image" class="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600" />
      <h2 class="mt-4 text-lg font-semibold text-gray-700 dark:text-gray-300">
        {{ q ? t("admin.media.searchEmpty.title") : t("admin.media.empty.title") }}
      </h2>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {{ q ? t("admin.media.searchEmpty.hint") : t("admin.media.empty.hint") }}
      </p>
    </div>

    <div v-else class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      <div
        v-for="item in items"
        :key="item.url"
        class="group rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden flex flex-col"
      >
        <div class="relative aspect-video bg-gray-100 dark:bg-gray-900 flex items-center justify-center overflow-hidden">
          <img
            :src="imageUrl(item)"
            :alt="item.filename"
            loading="lazy"
            class="w-full h-full object-contain"
          >
          <span
            class="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full font-medium"
            :class="item.referenced
              ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
              : 'bg-gray-100 dark:bg-gray-700/60 text-gray-600 dark:text-gray-300'"
            :title="item.referenced
              ? t('admin.media.referencedTitle', { n: item.referencing_posts.length })
              : undefined"
          >
            {{ item.referenced ? t("admin.media.referenced") : t("admin.media.unreferenced") }}
          </span>
          <!-- Bulk-delete selection (DEC-191): only unreferenced cards are
               selectable — referenced images cannot be deleted anyway. -->
          <button
            v-if="!item.referenced"
            type="button"
            :aria-label="t('admin.media.select')"
            class="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-md bg-white/90 dark:bg-gray-900/90 text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400"
            @click.stop="toggleSelect(item)"
          >
            <Icon
              :icon="isSelected(item) ? 'lucide:check-square' : 'lucide:square'"
              class="w-4 h-4"
            />
          </button>
        </div>

        <div class="p-3 flex-1 flex flex-col gap-1">
          <div class="text-xs text-gray-600 dark:text-gray-300 truncate" :title="item.filename">{{ item.filename }}</div>
          <div class="text-[11px] text-gray-400 dark:text-gray-500">
            {{ item.width && item.height ? t("admin.media.dimensions", { width: item.width, height: item.height }) + " · " : "" }}
            {{ formatSize(item.size) }}
          </div>
          <div class="text-[11px] text-gray-400 dark:text-gray-500">
            {{ t("admin.media.uploadedAt", { date: parseApiDate(item.uploaded_at)?.toLocaleDateString() ?? "" }) }}
          </div>

          <div class="mt-auto pt-2 flex gap-1.5">
            <button
              type="button"
              class="flex-1 text-xs px-2 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              @click="copyUrl(item)"
            >
              {{ copiedUrl === item.url ? t("admin.media.copied") : t("admin.media.copyUrl") }}
            </button>
            <button
              type="button"
              :disabled="item.referenced || isDeleting"
              class="text-xs px-2 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              :title="item.referenced
                ? t('admin.media.referencedTitle', { n: item.referencing_posts.length })
                : undefined"
              @click="handleDelete(item)"
            >
              {{ t("admin.media.delete") }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="totalPages > 1" class="mt-6 flex items-center justify-between">
      <button
        type="button"
        :disabled="currentPage === 1"
        class="px-3 py-1.5 text-sm rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-40 transition-colors"
        @click="goToPage(currentPage - 1)"
      >
        {{ t("admin.media.pagination.prev") }}
      </button>
      <span class="text-sm text-gray-500 dark:text-gray-400">{{ currentPage }} / {{ totalPages }}</span>
      <button
        type="button"
        :disabled="currentPage >= totalPages"
        class="px-3 py-1.5 text-sm rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-40 transition-colors"
        @click="goToPage(currentPage + 1)"
      >
        {{ t("admin.media.pagination.next") }}
      </button>
    </div>
  </div>
</template>
