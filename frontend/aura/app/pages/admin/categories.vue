<!--
  Admin Categories Page
  Migrated from Next.js /app/admin/categories/page.tsx to Nuxt 4 / Vue 3.
-->
<script setup lang="ts">
import { ref } from "vue";
import {
	createAdminCategory,
	deleteAdminCategory,
	fetchAdminCategories,
	updateAdminCategory,
} from "~/composables/useApi";

const { data: categories, pending, error, refresh } = await fetchAdminCategories();
const newCategoryName = ref("");
const isProcessing = ref(false);
const editingId = ref<number | null>(null);
const editingName = ref("");

async function handleCreate() {
	if (!newCategoryName.value.trim()) return;
	isProcessing.value = true;
	try {
		await createAdminCategory(newCategoryName.value.trim());
		newCategoryName.value = "";
		await refresh();
	} finally {
		isProcessing.value = false;
	}
}

async function startEdit(category: { id: number; name: string }) {
	editingId.value = category.id;
	editingName.value = category.name;
}

async function confirmEdit(id: number) {
	if (!editingName.value.trim()) return;
	isProcessing.value = true;
	try {
		await updateAdminCategory(id, editingName.value.trim());
		editingId.value = null;
		await refresh();
	} finally {
		isProcessing.value = false;
	}
}

async function handleDelete(id: number) {
	if (!confirm("确定要删除这个分类吗？")) return;
	isProcessing.value = true;
	try {
		await deleteAdminCategory(id);
		await refresh();
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
        分类管理
      </h1>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
        共 {{ categories?.length || 0 }} 个分类
      </p>
    </div>

    <!-- Create form -->
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-6 mb-6">
      <h2 class="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
        新建分类
      </h2>
      <div class="flex gap-3">
        <input
          v-model="newCategoryName"
          type="text"
          placeholder="分类名称"
          class="flex-1 px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
        >
        <button
          type="button"
          :disabled="!newCategoryName.trim() || isProcessing"
          class="px-6 py-3 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors"
          @click="handleCreate"
        >
          创建
        </button>
      </div>
    </div>

    <!-- Categories list -->
    <div v-if="pending" class="text-center py-12">
      <Icon icon="lucide:loader-2" class="w-5 h-5 animate-spin inline-block mr-2" />
      加载中...
    </div>

    <div v-else-if="error" class="text-center py-12 text-red-500">
      {{ error?.message || String(error) }}
    </div>

    <div
      v-else-if="!categories || categories.length === 0"
      class="text-center py-16 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800"
    >
      <Icon icon="lucide:folder" class="w-12 h-12 text-gray-400 mb-4 mx-auto" />
      <p class="text-gray-500 dark:text-gray-400">
        还没有任何分类
      </p>
    </div>

    <div
      v-else
      class="space-y-3"
    >
      <div
        v-for="category in categories"
        :key="category.id"
        class="flex items-center justify-between p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800"
      >
        <div class="flex-1">
          <input
            v-if="editingId === category.id"
            v-model="editingName"
            type="text"
            class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            @keydown.enter="confirmEdit(category.id)"
          >
          <span
            v-else
            class="text-gray-900 dark:text-gray-100 font-medium"
          >
            {{ category.name }}
          </span>
        </div>

        <div class="flex items-center gap-2">
          <button
            v-if="editingId === category.id"
            type="button"
            class="px-3 py-1.5 text-sm text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg transition-colors"
            @click="confirmEdit(category.id)"
          >
            确认
          </button>
          <button
            v-else
            type="button"
            class="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors"
            @click="startEdit(category)"
          >
            编辑
          </button>
          <button
            type="button"
            :disabled="isProcessing"
            class="px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
            @click="handleDelete(category.id)"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
