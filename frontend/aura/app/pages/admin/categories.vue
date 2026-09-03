<!--
  Admin Categories Page
  Migrated from Next.js /app/admin/categories/page.tsx to Nuxt 4 / Vue 3.
-->
<script setup lang="ts">
import { ref } from "vue";
import {
	createAdminCategory,
	deleteAdminCategory,
	updateAdminCategory,
	useAdminCategories,
} from "~~/api/admin/taxonomy";

definePageMeta({ layout: "admin" });

const { t } = useLang();

useHead({ title: computed(() => t("admin.categories.seoTitle")) });

const { data: categories, pending, error, refresh } = await useAdminCategories();
const newCategoryName = ref("");
const isProcessing = ref(false);
const editingId = ref<number | null>(null);
const editingName = ref("");
const actionError = ref<string | null>(null);
// Client-side filter: the taxonomy endpoint returns every category and a long
// unbounded list with no way to narrow it is wasted scrolling (ISS-311 part 3).
// Taxonomies are small enough that in-memory filtering beats server paging.
const search = ref("");
const visibleCategories = computed(() => {
	const q = search.value.trim().toLowerCase();
	if (!q) return categories.value ?? [];
	return (categories.value ?? []).filter((c: { name: string }) => c.name.toLowerCase().includes(q));
});

function getErrorMessage(e: unknown): string {
	if (e instanceof Error) return e.message;
	return t("admin.categories.operationFailed");
}

async function handleCreate() {
	if (!newCategoryName.value.trim()) return;
	isProcessing.value = true;
	actionError.value = null;
	try {
		await createAdminCategory(newCategoryName.value.trim());
		newCategoryName.value = "";
		await refresh();
	} catch (e) {
		actionError.value = getErrorMessage(e);
	} finally {
		isProcessing.value = false;
	}
}

async function startEdit(category: { id: number; name: string }) {
	editingId.value = category.id;
	editingName.value = category.name;
}

/** Abandon an in-progress edit. A mis-clicked Edit must not trap the operator
 * into committing or deleting — Cancel (and Escape) restores the row. */
function cancelEdit() {
	editingId.value = null;
	editingName.value = "";
}

async function confirmEdit(id: number) {
	if (!editingName.value.trim()) return;
	isProcessing.value = true;
	actionError.value = null;
	try {
		await updateAdminCategory(id, editingName.value.trim());
		editingId.value = null;
		await refresh();
	} catch (e) {
		actionError.value = getErrorMessage(e);
	} finally {
		isProcessing.value = false;
	}
}

async function handleDelete(id: number) {
	if (!confirm(t("admin.categories.confirmDelete"))) return;
	isProcessing.value = true;
	actionError.value = null;
	try {
		await deleteAdminCategory(id);
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
        {{ t("admin.categories.title") }}
      </h1>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
        {{ t("admin.categories.summary", { n: categories?.length || 0 }) }}
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
        {{ t("admin.categories.createTitle") }}
      </h2>
      <form class="flex gap-3" @submit.prevent="handleCreate">
        <input
          v-model="newCategoryName"
          type="text"
          :placeholder="t('admin.categories.namePlaceholder')"
          class="flex-1 px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
        >
        <button
          type="submit"
          :disabled="!newCategoryName.trim() || isProcessing"
          class="px-6 py-3 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors"
        >
          {{ t("admin.categories.create") }}
        </button>
      </form>
    </div>

    <!-- Categories list -->
    <div v-if="pending" class="text-center py-12">
      <Icon icon="lucide:loader-2" class="w-5 h-5 animate-spin inline-block mr-2" />
      {{ t("admin.categories.loading") }}
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
        {{ t("admin.categories.empty") }}
      </p>
    </div>

    <div
      v-else
    >
      <div class="relative mb-4">
        <Icon icon="lucide:search" class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          v-model="search"
          type="text"
          data-testid="taxonomy-search"
          :placeholder="t('admin.categories.searchPlaceholder')"
          :aria-label="t('admin.categories.searchPlaceholder')"
          class="w-full pl-9 pr-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
        />
      </div>
      <div
        v-if="visibleCategories.length === 0"
        class="text-center py-8 text-gray-500 dark:text-gray-400"
      >
        {{ t('admin.categories.searchEmpty') }}
      </div>
      <div
        v-else
        class="space-y-3"
      >
        <div
          v-for="category in visibleCategories"
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
            @keydown.esc="cancelEdit"
          >
          <span
            v-else
            class="text-gray-900 dark:text-gray-100 font-medium inline-flex items-center gap-2"
          >
            {{ category.name }}
            <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
              {{ category.post_count ?? 0 }}
            </span>
          </span>
        </div>

        <div class="flex items-center gap-2">
          <button
            v-if="editingId === category.id"
            type="button"
            class="px-3 py-1.5 text-sm text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg transition-colors"
            @click="confirmEdit(category.id)"
          >
            {{ t("admin.categories.confirm") }}
          </button>
          <button
            v-if="editingId === category.id"
            type="button"
            class="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors"
            @click="cancelEdit"
          >
            {{ t("admin.categories.cancel") }}
          </button>
          <button
            v-else
            type="button"
            class="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors"
            @click="startEdit(category)"
          >
            {{ t("admin.categories.edit") }}
          </button>
          <button
            type="button"
            :disabled="isProcessing"
            class="px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
            @click="handleDelete(category.id)"
          >
            {{ t("admin.categories.delete") }}
          </button>
        </div>
        </div>
      </div>
    </div>
  </div>
</template>
