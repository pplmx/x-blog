<script setup lang="ts">
import type { AdminComment, AdminCommentListResponse } from "~~/api/admin/comments";
import {
	approveAdminComment,
	batchApproveAdminComments,
	batchDeleteAdminComments,
	deleteAdminComment,
	dismissAdminCommentFlags,
	getAdminComments,
	replyAdminComment,
} from "~~/api/admin/comments";

definePageMeta({ layout: "admin" });

const { t, locale } = useLang();

useHead({ title: computed(() => t("admin.comments.seoTitle")) });

// Batch approve/reject is a superuser-only capability (get_current_superuser on
// /api/admin/comments/batch-approve). Hide the batch UI for editors so they
// never see a control that would 403; single-comment moderation stays enabled.
// Defaults to visible and downgrades only on a confirmed editor role so a
// failed/missing /me response never hides controls from a superuser; the
// backend still enforces authorization independently.
const config = useRuntimeConfig();
const apiBase = (config.public.apiUrl || "").replace(/\/+$/, "");
const canBatch = ref(true);
function adminHeaders(): Record<string, string> {
	const token = typeof localStorage !== "undefined" ? localStorage.getItem("admin_token") : null;
	return token ? { Authorization: `Bearer ${token}` } : {};
}
onMounted(async () => {
	try {
		const data = await $fetch<{ role: string }>(`${apiBase}/api/admin/me`, {
			headers: adminHeaders(),
		}).catch(() => null);
		if (data && data.role === "editor") canBatch.value = false;
	} catch {
		/* keep visible default */
	}
});

const PAGE_SIZE = 20;
// Moderation filters (RIL TASK-078, ISS-047): status, full-text search and
// created-date range. Applied server-side; the list refetches on change.
const statusFilter = ref<"all" | "pending" | "approved">("all");
const flaggedOnly = ref(false);
const searchQuery = ref("");
const dateFrom = ref("");
const dateTo = ref("");

function activeFilters() {
	return {
		isApproved: flaggedOnly.value
			? undefined
			: statusFilter.value === "pending"
				? false
				: statusFilter.value === "approved"
					? true
					: undefined,
		flagged: flaggedOnly.value || undefined,
		q: searchQuery.value.trim() || undefined,
		dateFrom: dateFrom.value || undefined,
		dateTo: dateTo.value || undefined,
	};
}

// The list is our OWN ref, written only through the sequenced loader below.
// Binding it to the setup-top-level useFetch's live data ref let the initial
// (slower) request clobber a later applied filter — clicking 待审核 then
// reverted to the full mixed list once the first fetch landed (RIL ISS-097:
// e2e "filter by status" intermittently flaky). Latest-wins sequencing makes
// every writer — initial load, filter, paging, post-approve refresh — safe.
const comments = ref<AdminCommentListResponse | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const currentPage = ref(1);
const isProcessing = ref(false);
const selectedIds = ref<Set<number>>(new Set());
const actionError = ref<string | null>(null);
const deletedMessage = ref<string>("");

let listRequestSeq = 0;

/** Fetch one page of comments; only the most recently issued request wins. */
async function loadComments(filters: ReturnType<typeof activeFilters>, page: number) {
	const seq = ++listRequestSeq;
	loading.value = true;
	try {
		const data = await getAdminComments(filters, page, PAGE_SIZE);
		if (seq === listRequestSeq) {
			comments.value = data;
			error.value = null;
		}
	} catch (e) {
		if (seq === listRequestSeq) {
			error.value = getErrorMessage(e);
		}
	} finally {
		if (seq === listRequestSeq) {
			loading.value = false;
		}
	}
}

/** Initial load (same guarded loader as every other writer). */
onMounted(() => {
	void loadComments(activeFilters(), 1);
});

/** Apply the active filters and reload from page 1. */
async function applyFilters() {
	currentPage.value = 1;
	selectedIds.value = new Set();
	await loadComments(activeFilters(), 1);
}

/** Clear all filters back to the unfiltered list. */
function clearFilters() {
	statusFilter.value = "all";
	flaggedOnly.value = false;
	searchQuery.value = "";
	dateFrom.value = "";
	dateTo.value = "";
	applyFilters();
}

function getErrorMessage(e: unknown): string {
	if (e instanceof Error) return e.message;
	if (e && typeof e === "object" && "message" in e) {
		const m = (e as { message?: unknown }).message;
		if (typeof m === "string" && m) return m;
	}
	return t("admin.comments.operationFailed");
}

const totalPages = computed(() => comments.value?.pagination?.total_pages ?? 1);

/** Switch to another page of the comments list. */
async function gotoPage(page: number) {
	if (page < 1 || page > totalPages.value || page === currentPage.value) return;
	currentPage.value = page;
	selectedIds.value = new Set();
	await loadComments(activeFilters(), page);
}

const pendingComments = computed(() =>
	(comments.value?.items ?? []).filter((c: AdminComment) => !c.is_approved),
);

function toggleSelect(id: number) {
	const s = new Set(selectedIds.value);
	if (s.has(id)) s.delete(id);
	else s.add(id);
	selectedIds.value = s;
}

function toggleSelectAll() {
	const items = comments.value?.items ?? [];
	if (selectedIds.value.size === items.length) {
		selectedIds.value = new Set();
	} else {
		selectedIds.value = new Set(items.map((c: AdminComment) => c.id));
	}
}

async function batchApprove(approved: boolean) {
	if (selectedIds.value.size === 0) return;
	isProcessing.value = true;
	actionError.value = null;
	try {
		await batchApproveAdminComments(Array.from(selectedIds.value), approved);
		selectedIds.value = new Set();
		await loadComments(activeFilters(), currentPage.value);
	} catch (e) {
		actionError.value = getErrorMessage(e);
	} finally {
		isProcessing.value = false;
	}
}

async function batchDelete() {
	const ids = Array.from(selectedIds.value);
	if (ids.length === 0) return;
	if (!confirm(t("admin.comments.confirmBatchDelete", { n: ids.length }))) return;
	isProcessing.value = true;
	actionError.value = null;
	deletedMessage.value = "";
	try {
		const { deleted } = await batchDeleteAdminComments(ids);
		selectedIds.value = new Set();
		deletedMessage.value = t("admin.comments.deletedFeedback", { n: deleted });
		await loadComments(activeFilters(), currentPage.value);
	} catch (e) {
		actionError.value = getErrorMessage(e);
	} finally {
		isProcessing.value = false;
	}
}

async function handleDelete(id: number) {
	if (!confirm(t("admin.comments.confirmDelete"))) return;
	isProcessing.value = true;
	actionError.value = null;
	try {
		await deleteAdminComment(id);
		await loadComments(activeFilters(), currentPage.value);
	} catch (e) {
		actionError.value = getErrorMessage(e);
	} finally {
		isProcessing.value = false;
	}
}

/** Dismiss all reader flags on a comment, then reload the queue. (DEC-108) */
async function handleDismissFlags(id: number) {
	isProcessing.value = true;
	actionError.value = null;
	try {
		await dismissAdminCommentFlags(id);
		await loadComments(activeFilters(), currentPage.value);
	} catch (e) {
		actionError.value = getErrorMessage(e);
	} finally {
		isProcessing.value = false;
	}
}

async function handleApprove(id: number, approved: boolean) {
	isProcessing.value = true;
	actionError.value = null;
	try {
		await approveAdminComment(id, approved);
		await loadComments(activeFilters(), currentPage.value);
	} catch (e) {
		actionError.value = getErrorMessage(e);
	} finally {
		isProcessing.value = false;
	}
}

// Author reply (DEC-192, TASK-212): one inline reply box at a time, targeting
// an approved comment (the public thread only shows public comments; replying
// to a pending one would leave an approved reply under a hidden parent).
const replyOpenId = ref<number | null>(null);
const replyText = ref("");
const replySending = ref(false);

function openReply(id: number) {
	replyOpenId.value = id;
	replyText.value = "";
}

function closeReply() {
	replyOpenId.value = null;
	replyText.value = "";
}

async function submitReply(id: number) {
	const content = replyText.value.trim();
	if (!content || replySending.value) return;
	replySending.value = true;
	actionError.value = null;
	try {
		await replyAdminComment(id, content);
		replyOpenId.value = null;
		replyText.value = "";
		await loadComments(activeFilters(), currentPage.value);
	} catch (e) {
		actionError.value = getErrorMessage(e);
	} finally {
		replySending.value = false;
	}
}
</script>

<template>
  <div>
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
      <div>
        <h1 class="text-2xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent">
          {{ t("admin.comments.title") }}
        </h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {{ t("admin.comments.summary", { total: comments?.pagination?.total ?? 0 }) }}<span class="text-amber-600 dark:text-amber-400">{{ t("admin.comments.pendingSummary", { n: pendingComments.length }) }}</span>
        </p>
      </div>
      <div
        v-if="actionError"
        class="mb-6 px-4 py-3 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-600 dark:text-red-400"
      >
        {{ actionError }}
      </div>
      <div
        v-if="canBatch && comments && comments.items.length > 0"
        class="flex items-center gap-2"
      >
        <template v-if="selectedIds.size > 0">
          <button
            type="button"
            :disabled="isProcessing"
            class="px-4 py-2 text-sm bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/50 transition-colors disabled:opacity-40"
            @click="batchApprove(true)"
          >
            {{ t("admin.comments.batchApprove", { n: selectedIds.size }) }}
          </button>
          <button
            type="button"
            :disabled="isProcessing"
            class="px-4 py-2 text-sm bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors disabled:opacity-40"
            @click="batchApprove(false)"
          >
            {{ t("admin.comments.batchReject", { n: selectedIds.size }) }}
          </button>
          <button
            type="button"
            :disabled="isProcessing"
            class="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-40"
            @click="batchDelete"
          >
            {{ t("admin.comments.batchDelete", { n: selectedIds.size }) }}
          </button>
        </template>
        <span
          v-if="deletedMessage"
          class="text-sm text-emerald-600 dark:text-emerald-400"
        >{{ deletedMessage }}</span>
        <label class="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            :checked="selectedIds.size > 0 && comments.items.length > 0 && selectedIds.size === comments.items.length"
            :indeterminate="selectedIds.size > 0 && selectedIds.size < comments.items.length"
            @change="toggleSelectAll"
          >
          {{ t("admin.comments.selectAll") }}
        </label>
      </div>
    </div>

    <!-- Moderation filters (RIL TASK-078, ISS-047) -->
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-4 mb-6 flex flex-wrap items-end gap-3">
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-gray-500 dark:text-gray-400">
          {{ t("admin.comments.status") }}
        </label>
        <div class="inline-flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
          <button
            type="button"
            :class="statusFilter === 'all'
              ? 'bg-blue-500 text-white'
              : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'"
            class="px-3 py-1.5 text-sm font-medium transition-colors"
            @click="statusFilter = 'all'; flaggedOnly = false; applyFilters()"
          >
            {{ t("admin.comments.filterAll") }}
          </button>
          <button
            type="button"
            :class="statusFilter === 'pending'
              ? 'bg-amber-500 text-white'
              : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'"
            class="px-3 py-1.5 text-sm font-medium transition-colors"
            @click="statusFilter = 'pending'; flaggedOnly = false; applyFilters()"
          >
            {{ t("admin.comments.filterPending") }}
          </button>
          <button
            type="button"
            :class="statusFilter === 'approved'
              ? 'bg-green-500 text-white'
              : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'"
            class="px-3 py-1.5 text-sm font-medium transition-colors"
            @click="statusFilter = 'approved'; flaggedOnly = false; applyFilters()"
          >
            {{ t("admin.comments.filterApproved") }}
          </button>
          <button
            type="button"
            :class="flaggedOnly
              ? 'bg-red-500 text-white'
              : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'"
            class="px-3 py-1.5 text-sm font-medium transition-colors"
            @click="statusFilter = 'all'; flaggedOnly = true; applyFilters()"
          >
            {{ t("admin.comments.filterFlagged") }}
          </button>
        </div>
      </div>
      <div class="flex flex-col gap-1 flex-1 min-w-48">
        <label class="text-xs font-medium text-gray-500 dark:text-gray-400">
          {{ t("admin.comments.search") }}
        </label>
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="t('admin.comments.searchPlaceholder')"
          class="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          @keydown.enter="applyFilters"
        >
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-gray-500 dark:text-gray-400">
          {{ t("admin.comments.dateFrom") }}
        </label>
        <input
          v-model="dateFrom"
          type="date"
          class="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-gray-500 dark:text-gray-400">
          {{ t("admin.comments.dateTo") }}
        </label>
        <input
          v-model="dateTo"
          type="date"
          class="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
      </div>
      <button
        type="button"
        class="px-4 py-1.5 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
        @click="applyFilters"
      >
        {{ t("admin.comments.apply") }}
      </button>
      <button
        type="button"
        class="px-4 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
        @click="clearFilters"
      >
        {{ t("admin.comments.clear") }}
      </button>
    </div>

    <div v-if="loading" class="text-center py-12">
      <div class="inline-flex items-center gap-2 text-gray-500">
        <Icon icon="lucide:loader-2" class="w-5 h-5 animate-spin" />
        {{ t("admin.comments.loading") }}
      </div>
    </div>

    <div v-else-if="error" class="text-center py-12 text-red-500">
      {{ error }}
    </div>

    <div v-else-if="!comments || !comments.items || comments.items.length === 0" class="flex flex-col items-center justify-center py-16 bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800">
      <Icon icon="lucide:message-circle" class="w-12 h-12 text-gray-400 mb-4" />
      <h3 class="text-lg font-medium text-gray-700 dark:text-gray-300 mb-1">
        {{ t("admin.comments.empty.title") }}
      </h3>
      <p class="text-sm text-gray-500 dark:text-gray-400">
        {{ t("admin.comments.empty.subtitle") }}
      </p>
    </div>

    <div v-else class="space-y-3">
      <div
        v-for="comment in comments.items"
        :key="comment.id"
        class="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5 shadow-sm"
        :class="{ 'ring-2 ring-amber-300 dark:ring-amber-700': !comment.is_approved }"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1">
            <div class="flex items-center gap-3 mb-2">
              <input
                v-if="canBatch"
                type="checkbox"
                class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                :checked="selectedIds.has(comment.id)"
                @change="toggleSelect(comment.id)"
              >
              <span class="font-medium text-gray-900 dark:text-gray-100">
                {{ comment.nickname }}
              </span>
              <span
                v-if="comment.is_author_reply"
                class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
              >
                {{ t("admin.comments.authorReply") }}
              </span>
              <span class="text-sm text-gray-500 dark:text-gray-400">
                {{ comment.email }}
              </span>
              <span
                :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', comment.is_approved
                  ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                  : 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400']"
              >
                {{ comment.is_approved ? t('admin.comments.approved') : t('admin.comments.pending') }}
              </span>
              <span
                v-if="(comment.flag_count ?? 0) > 0"
                class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400"
              >
                <Icon icon="lucide:flag" class="w-3 h-3 mr-1" />
                {{ t('admin.comments.flaggedBadge', { n: comment.flag_count ?? 0 }) }}
              </span>
            </div>

            <p class="text-gray-700 dark:text-gray-300 mb-2">
              {{ comment.content }}
            </p>

            <!-- Author reply box (DEC-192): open per comment, submits as the
                 blog owner, then reloads the queue to show the created reply. -->
            <div v-if="replyOpenId === comment.id" class="mb-2">
              <textarea
                v-model="replyText"
                rows="2"
                :placeholder="t('admin.comments.replyPlaceholder')"
                class="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              ></textarea>
              <div class="flex gap-2 mt-1.5">
                <button
                  type="button"
                  :disabled="replySending || !replyText.trim()"
                  class="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
                  @click="submitReply(comment.id)"
                >
                  {{ t("admin.comments.sendReply") }}
                </button>
                <button
                  type="button"
                  class="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                  @click="closeReply"
                >
                  {{ t("common.cancel") }}
                </button>
              </div>
            </div>

            <div class="text-xs text-gray-400 dark:text-gray-500 space-x-3">
              <span>{{ comment.post_title }}</span>
              <span>{{ comment.ip_address }}</span>
              <span>{{ new Date(comment.created_at).toLocaleString(locale === "zh" ? "zh-CN" : "en-US") }}</span>
            </div>
          </div>

          <div class="flex flex-col gap-1.5 shrink-0">
            <button
              v-if="comment.is_approved"
              type="button"
              :disabled="isProcessing"
              class="px-3 py-1.5 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-lg transition-colors"
              @click="replyOpenId === comment.id ? closeReply() : openReply(comment.id)"
            >
              {{ replyOpenId === comment.id ? t("common.cancel") : t("admin.comments.reply") }}
            </button>
            <button
              v-if="!comment.is_approved"
              type="button"
              :disabled="isProcessing"
              class="px-3 py-1.5 text-xs bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/50 transition-colors"
              @click="handleApprove(comment.id, true)"
            >
              {{ t("admin.comments.approve") }}
            </button>
            <button
              v-if="comment.is_approved"
              type="button"
              :disabled="isProcessing"
              class="px-3 py-1.5 text-xs bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors"
              @click="handleApprove(comment.id, false)"
            >
              {{ t("admin.comments.revoke") }}
            </button>
            <button
              v-if="(comment.flag_count ?? 0) > 0"
              type="button"
              :disabled="isProcessing"
              class="px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100 dark:hover:bg-amber-900/50 rounded-lg transition-colors"
              @click="handleDismissFlags(comment.id)"
            >
              {{ t("admin.comments.dismissFlags") }}
            </button>
            <button
              type="button"
              :disabled="isProcessing"
              class="px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
              @click="handleDelete(comment.id)"
            >
              {{ t("admin.comments.delete") }}
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="totalPages > 1"
        class="flex items-center justify-between pt-6 border-t border-gray-100 dark:border-gray-800"
      >
        <button
          type="button"
          :disabled="currentPage <= 1"
          class="px-4 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          @click="gotoPage(currentPage - 1)"
        >
          {{ t("admin.comments.pagination.prev") }}
        </button>
        <span class="text-sm text-gray-500 dark:text-gray-400">
          {{ t("admin.comments.pagination.page", { current: currentPage, total: totalPages }) }}
        </span>
        <button
          type="button"
          :disabled="currentPage >= totalPages"
          class="px-4 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          @click="gotoPage(currentPage + 1)"
        >
          {{ t("admin.comments.pagination.next") }}
        </button>
      </div>
    </div>
  </div>
</template>
