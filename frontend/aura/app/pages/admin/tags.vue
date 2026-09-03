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
	updateAdminTag,
	useAdminTags,
} from "~~/api/admin/taxonomy";

definePageMeta({ layout: "admin" });

const { t } = useLang();

useHead({ title: computed(() => t("admin.tags.seoTitle")) });

const { data: tags, pending, error, refresh } = await useAdminTags();
const newTagName = ref("");
const isProcessing = ref(false);
const editingId = ref<number | null>(null);
const editingName = ref("");
const actionError = ref<string | null>(null);
// Client-side filter: the taxonomy endpoint returns every tag and a long
// unbounded list with no way to narrow it is wasted scrolling (ISS-311 part 3).
// Tags are small enough that in-memory filtering beats server paging.
const search = ref("");
const visibleTags = computed(() => {
	const q = search.value.trim().toLowerCase();
	if (!q) return tags.value ?? [];
	return (tags.value ?? []).filter((t: { name: string }) => t.name.toLowerCase().includes(q));
});

function getErrorMessage(e: unknown): string {
	if (e instanceof Error) return e.message;
	return t("admin.tags.operationFailed");
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
	if (!confirm(t("admin.tags.confirmDelete"))) return;
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
        {{ t("admin.tags.title") }}
      </h1>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
        {{ t("admin.tags.summary", { n: tags?.length || 0 }) }}
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
        {{ t("admin.tags.createTitle") }}
      </h2>
      <form class="flex gap-3" @submit.prevent="handleCreate">
        <input
          v-model="newTagName"
          type="text"
          :placeholder="t('admin.tags.namePlaceholder')"
          class="flex-1 px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
        >
        <button
          type="submit"
          :disabled="!newTagName.trim() || isProcessing"
          class="px-6 py-3 bg-pink-500 text-white rounded-xl font-medium hover:bg-pink-600 disabled:opacity-50 transition-colors"
        >
          {{ t("admin.tags.create") }}
        </button>
      </form>
    </div>

    <!-- Tags list -->
    <div v-if="pending" class="text-center py-12">
      <Icon icon="lucide:loader-2" class="w-5 h-5 animate-spin inline-block mr-2" />
      {{ t("admin.tags.loading") }}
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
        {{ t("admin.tags.empty") }}
      </p>
    </div>

    <div v-else>
      <div class="relative mb-4">
        <Icon icon="lucide:search" class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          v-model="search"
          type="text"
          data-testid="taxonomy-search"
          :placeholder="t('admin.tags.searchPlaceholder')"
          :aria-label="t('admin.tags.searchPlaceholder')"
          class="w-full pl-9 pr-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
        />
      </div>
      <div
        v-if="visibleTags.length === 0"
        class="text-center py-8 text-gray-500 dark:text-gray-400"
      >
        {{ t('admin.tags.searchEmpty') }}
      </div>
      <div v-else class="flex flex-wrap gap-3">
        <div
          v-for="tag in visibleTags"
          :key="tag.id"
          class="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800"
        >
        <div v-if="editingId === tag.id" class="flex items-center gap-2 flex-1">
          <input
            v-model="editingName"
            type="text"
            class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            @keydown.enter="confirmEdit(tag.id)"
            @keydown.esc="cancelEdit"
          >
          <button
            type="button"
            :title="t('admin.tags.confirm')"
            :aria-label="t('admin.tags.confirm')"
            class="px-2 py-1 text-sm text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg transition-colors"
            @click="confirmEdit(tag.id)"
          >
            <Icon icon="lucide:check" class="w-4 h-4" />
          </button>
          <button
            type="button"
            :title="t('admin.tags.cancel')"
            :aria-label="t('admin.tags.cancel')"
            class="px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            @click="cancelEdit"
          >
            <Icon icon="lucide:x" class="w-4 h-4" />
          </button>
        </div>
        <template v-else>
          <div class="flex items-center gap-2">
            <Icon icon="lucide:tag" class="w-4 h-4 text-pink-500" />
            <span class="font-medium text-gray-900 dark:text-gray-100 inline-flex items-center gap-2">
              #{{ tag.name }}
              <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                {{ tag.post_count ?? 0 }}
              </span>
            </span>
          </div>
          <button
            type="button"
            :title="t('admin.tags.edit')"
            :aria-label="t('admin.tags.edit')"
            class="px-2 py-1 text-sm text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
            @click="startEdit(tag)"
          >
            <Icon icon="lucide:pencil" class="w-4 h-4" />
          </button>
          <button
            type="button"
            :title="t('admin.tags.delete')"
            :aria-label="t('admin.tags.delete')"
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
  </div>
</template>
