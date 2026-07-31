<!--
  Admin Tags Page
  Migrated from Next.js /app/admin/tags/page.tsx to Nuxt 4 / Vue 3.
  Uses Nuxt's useFetch for data fetching (no React Query needed).
-->
<script setup lang="ts">
import { ref } from "vue";
import {
	createAdminTag,
	deleteAdminTag,
	fetchAdminTags,
	updateAdminTag,
} from "~~/composables/useApi";

definePageMeta({ layout: "admin" });

useHead({ title: "标签管理 - X-Blog" });

const { data: tags, pending, error, refresh } = await fetchAdminTags();
const newTagName = ref("");
const isProcessing = ref(false);
const editingId = ref<number | null>(null);
const editingName = ref("");
const actionError = ref<string | null>(null);

function getErrorMessage(e: unknown): string {
	if (e instanceof Error) return e.message;
	return "操作失败，请重试";
}

async function handleCreate() {
	if (!newTagName.value.trim()) return;
	isProcessing.value = true;
	actionError.value = null;
	try {
		await createAdminTag(newTagName.value.trim());
		newTagName.value = "";
		await refresh();
	} catch (e) {
		actionError.value = getErrorMessage(e);
	} finally {
		isProcessing.value = false;
	}
}

async function startEdit(tag: { id: number; name: string }) {
	editingId.value = tag.id;
	editingName.value = tag.name;
}

async function confirmEdit(id: number) {
	if (!editingName.value.trim()) return;
	isProcessing.value = true;
	actionError.value = null;
	try {
		await updateAdminTag(id, editingName.value.trim());
		editingId.value = null;
		await refresh();
	} catch (e) {
		actionError.value = getErrorMessage(e);
	} finally {
		isProcessing.value = false;
	}
}

async function handleDelete(id: number) {
	if (!confirm("确定要删除这个标签吗？")) return;
	isProcessing.value = true;
	actionError.value = null;
	try {
		await deleteAdminTag(id);
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
    <div class="mb-8">
      <h1
        class="text-2xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent"
      >
        标签管理
      </h1>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
        共 {{ tags?.length || 0 }} 个标签
      </p>
    </div>

    <!-- Action error feedback -->
    <div
      v-if="actionError"
      class="mb-6 px-4 py-3 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-600 dark:text-red-400"
    >
      {{ actionError }}
    </div>

    <!-- Create form -->
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-6 mb-6">
      <h2 class="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
        新建标签
      </h2>
      <div class="flex gap-3">
        <input
          v-model="newTagName"
          type="text"
          placeholder="标签名称"
          class="flex-1 px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
        >
        <button
          type="button"
          :disabled="!newTagName.trim() || isProcessing"
          class="px-6 py-3 bg-pink-500 text-white rounded-xl font-medium hover:bg-pink-600 disabled:opacity-50 transition-colors"
          @click="handleCreate"
        >
          创建
        </button>
      </div>
    </div>

    <!-- Tags list -->
    <div v-if="pending" class="text-center py-12">
      <Icon icon="lucide:loader-2" class="w-5 h-5 animate-spin inline-block mr-2" />
      加载中...
    </div>

    <div v-else-if="error" class="text-center py-12 text-red-500">
      {{ error?.message || String(error) }}
    </div>

    <div
      v-else-if="!tags || tags.length === 0"
      class="text-center py-16 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800"
    >
      <Icon icon="lucide:tag" class="w-12 h-12 text-gray-400 mb-4 mx-auto" />
      <p class="text-gray-500 dark:text-gray-400">
        还没有任何标签
      </p>
    </div>

    <div v-else class="flex flex-wrap gap-3">
      <div
        v-for="tag in tags"
        :key="tag.id"
        class="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800"
      >
        <div v-if="editingId === tag.id" class="flex items-center gap-2 flex-1">
          <input
            v-model="editingName"
            type="text"
            class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            @keydown.enter="confirmEdit(tag.id)"
          >
          <button
            type="button"
            class="px-2 py-1 text-sm text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg transition-colors"
            @click="confirmEdit(tag.id)"
          >
            <Icon icon="lucide:check" class="w-4 h-4" />
          </button>
          <button
            type="button"
            class="px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            @click="editingId = null"
          >
            <Icon icon="lucide:x" class="w-4 h-4" />
          </button>
        </div>
        <template v-else>
          <div class="flex items-center gap-2">
            <Icon icon="lucide:tag" class="w-4 h-4 text-pink-500" />
            <span class="font-medium text-gray-900 dark:text-gray-100">
              #{{ tag.name }}
            </span>
          </div>
          <button
            type="button"
            class="px-2 py-1 text-sm text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
            @click="startEdit(tag)"
          >
            <Icon icon="lucide:pencil" class="w-4 h-4" />
          </button>
          <button
            type="button"
            :disabled="isProcessing"
            class="px-2 py-1 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
            @click="handleDelete(tag.id)"
          >
            <Icon icon="lucide:trash-2" class="w-4 h-4" />
          </button>
        </template>
      </div>
    </div>
  </div>
</template>
