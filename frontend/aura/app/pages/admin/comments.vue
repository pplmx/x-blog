<script setup lang="ts">
import type { AdminComment } from "~~/composables/useApi";
import {
	approveAdminComment,
	batchApproveAdminComment,
	deleteAdminComment,
	fetchAdminComments,
} from "~~/composables/useApi";

definePageMeta({ layout: "admin" });

const { t } = useLang();

useHead({ title: computed(() => t("admin.comments.seoTitle")) });

const PAGE_SIZE = 20;
const {
	data: comments,
	pending,
	error,
	refresh,
} = await fetchAdminComments(undefined, 1, PAGE_SIZE);
const currentPage = ref(1);
const isProcessing = ref(false);
const selectedIds = ref<Set<number>>(new Set());
const actionError = ref<string | null>(null);

function getErrorMessage(e: unknown): string {
	if (e instanceof Error) return e.message;
	return t("admin.comments.operationFailed");
}

const totalPages = computed(() => comments.value?.pagination?.total_pages ?? 1);

/** Switch to another page of the comments list. */
async function gotoPage(page: number) {
	if (page < 1 || page > totalPages.value || page === currentPage.value) return;
	currentPage.value = page;
	selectedIds.value = new Set();
	const res = await fetchAdminComments(undefined, page, PAGE_SIZE);
	comments.value = res.data.value;
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
	const pendings = (comments.value?.items ?? []).filter((c: AdminComment) => !c.is_approved);
	if (selectedIds.value.size === pendings.length) {
		selectedIds.value = new Set();
	} else {
		selectedIds.value = new Set(pendings.map((c: AdminComment) => c.id));
	}
}

async function batchApprove(approved: boolean) {
	if (selectedIds.value.size === 0) return;
	isProcessing.value = true;
	actionError.value = null;
	try {
		await batchApproveAdminComment(Array.from(selectedIds.value), approved);
		selectedIds.value = new Set();
		await refresh();
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
		await refresh();
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
		await refresh();
	} catch (e) {
		actionError.value = getErrorMessage(e);
	} finally {
		isProcessing.value = false;
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
      <div v-if="pendingComments.length > 0" class="flex items-center gap-2">
        <button
          type="button"
          :disabled="isProcessing || selectedIds.size === 0"
          class="px-4 py-2 text-sm bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/50 transition-colors disabled:opacity-40"
          @click="batchApprove(true)"
        >
          {{ t("admin.comments.batchApprove", { n: selectedIds.size }) }}
        </button>
        <button
          type="button"
          :disabled="isProcessing || selectedIds.size === 0"
          class="px-4 py-2 text-sm bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors disabled:opacity-40"
          @click="batchApprove(false)"
        >
          {{ t("admin.comments.batchReject", { n: selectedIds.size }) }}
        </button>
        <label class="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            :checked="pendingComments.length > 0 && selectedIds.size === pendingComments.length"
            :indeterminate="selectedIds.size > 0 && selectedIds.size < pendingComments.length"
            @change="toggleSelectAll"
          >
          {{ t("admin.comments.selectAll") }}
        </label>
      </div>
    </div>

    <div v-if="pending" class="text-center py-12">
      <div class="inline-flex items-center gap-2 text-gray-500">
        <Icon icon="lucide:loader-2" class="w-5 h-5 animate-spin" />
        {{ t("admin.comments.loading") }}
      </div>
    </div>

    <div v-else-if="error" class="text-center py-12 text-red-500">
      {{ error?.message || String(error) }}
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
                v-if="!comment.is_approved"
                type="checkbox"
                class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                :checked="selectedIds.has(comment.id)"
                @change="toggleSelect(comment.id)"
              >
              <span class="font-medium text-gray-900 dark:text-gray-100">
                {{ comment.nickname }}
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
            </div>

            <p class="text-gray-700 dark:text-gray-300 mb-2">
              {{ comment.content }}
            </p>

            <div class="text-xs text-gray-400 dark:text-gray-500 space-x-3">
              <span>{{ comment.post_title }}</span>
              <span>{{ comment.ip_address }}</span>
              <span>{{ new Date(comment.created_at).toLocaleString('zh-CN') }}</span>
            </div>
          </div>

          <div class="flex flex-col gap-1.5 shrink-0">
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
