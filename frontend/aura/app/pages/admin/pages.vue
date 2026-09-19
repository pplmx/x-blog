<!--
  Admin Pages Page
  Static pages CMS (round 347): create, publish/unpublish, edit and delete the
  admin-curated pages served publicly at /pages/{slug} (privacy, terms,
  contact, ...). Mirrors the admin series page (slug auto-generation from the
  title, inline row editing, confirm-before-delete).
-->
<script setup lang="ts">
import { ref } from "vue";
import {
	createAdminPage,
	deleteAdminPage,
	updateAdminPage,
	useAdminPages,
} from "~~/api/admin/pages";
import { apiErrorMessage } from "~~/api/errors";

definePageMeta({ layout: "admin" });

const { t } = useLang();

useHead({ title: computed(() => t("admin.pages.seoTitle")) });

const { data: pages, pending, error, refresh } = await useAdminPages();
const isProcessing = ref(false);
const actionError = ref<string | null>(null);

const editingId = ref<number | null>(null);

const newForm = ref({ title: "", slug: "", content: "", published: false });
const editingForm = ref({ title: "", slug: "", content: "", published: false });

function getErrorMessage(e: unknown): string {
	// Shared admin error surfacing (round 394): the backend envelope's human
	// message first, then a local non-HTTP error's own message, else the
	// localized fallback — never ofetch's technical "[POST] ...: xxx" string.
	return apiErrorMessage(e, t("admin.pages.operationFailed"));
}

// Same CJK-safe slug fallback as the series manager and post editor: a
// pure-CJK title can't ASCII-slugify, so it gets a deterministic hash slug
// instead of blocking the save.
function generateSlug(title: string): string {
	let slug = title
		.toLowerCase()
		.replace(/[^\w\s-]/g, "")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "")
		.trim();
	if (!slug) {
		let hash = 0;
		for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) & 0x7fffffff;
		slug = `page-${hash.toString(36)}`;
	}
	return slug;
}

async function handleCreate() {
	if (isProcessing.value) return; // single-flight — Enter in the form can fire
	if (!newForm.value.title.trim()) return;
	isProcessing.value = true;
	actionError.value = null;
	try {
		await createAdminPage({
			title: newForm.value.title.trim(),
			slug: newForm.value.slug.trim() || generateSlug(newForm.value.title.trim()),
			content: newForm.value.content,
			published: newForm.value.published,
		});
		newForm.value = { title: "", slug: "", content: "", published: false };
		await refresh();
	} catch (e) {
		actionError.value = getErrorMessage(e);
	} finally {
		isProcessing.value = false;
	}
}

function startEdit(p: {
	id: number;
	title: string;
	slug: string;
	content: string;
	published: boolean;
}) {
	editingId.value = p.id;
	editingForm.value = {
		title: p.title,
		slug: p.slug,
		content: p.content,
		published: p.published,
	};
}

/** Abandon an in-progress edit. A mis-clicked Edit must not trap the operator
 * into committing or deleting — Cancel (and Escape) restores the row. */
function cancelEdit() {
	editingId.value = null;
}

async function confirmEdit(id: number) {
	if (isProcessing.value) return; // single-flight
	if (!editingForm.value.title.trim()) return;
	isProcessing.value = true;
	actionError.value = null;
	try {
		await updateAdminPage(id, {
			title: editingForm.value.title.trim(),
			slug: editingForm.value.slug.trim() || generateSlug(editingForm.value.title.trim()),
			content: editingForm.value.content,
			published: editingForm.value.published,
		});
		editingId.value = null;
		await refresh();
	} catch (e) {
		actionError.value = getErrorMessage(e);
	} finally {
		isProcessing.value = false;
	}
}

/** Flip just the published flag without opening the full editor. */
async function togglePublished(p: { id: number; published: boolean }) {
	if (isProcessing.value) return;
	isProcessing.value = true;
	actionError.value = null;
	try {
		await updateAdminPage(p.id, { published: !p.published });
		await refresh();
	} catch (e) {
		actionError.value = getErrorMessage(e);
	} finally {
		isProcessing.value = false;
	}
}

async function handleDelete(id: number) {
	if (isProcessing.value) return; // single-flight
	if (!confirm(t("admin.pages.confirmDelete"))) return;
	isProcessing.value = true;
	actionError.value = null;
	try {
		await deleteAdminPage(id);
		if (editingId.value === id) editingId.value = null;
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
        {{ t("admin.pages.title") }}
      </h1>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
        {{ t("admin.pages.summary", { n: pages?.length || 0 }) }}
      </p>
    </div>

    <!-- Action error feedback -->
    <div
      v-if="actionError"
      role="alert"
      class="mb-6 px-4 py-3 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-600 dark:text-red-400"
    >
      {{ actionError }}
    </div>

    <!-- Create form -->
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-6 mb-6">
      <h2 class="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
        {{ t("admin.pages.createTitle") }}
      </h2>
      <form class="space-y-4" @submit.prevent="handleCreate">
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="block text-sm text-gray-600 dark:text-gray-300 mb-1" for="page-title">
              {{ t("admin.pages.titleLabel") }}
            </label>
            <input
              id="page-title"
              v-model="newForm.title"
              type="text"
              :placeholder="t('admin.pages.titlePlaceholder')"
              class="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            >
          </div>
          <div>
            <label class="block text-sm text-gray-600 dark:text-gray-300 mb-1" for="page-slug">
              {{ t("admin.pages.slugLabel") }}
            </label>
            <input
              id="page-slug"
              v-model="newForm.slug"
              type="text"
              :placeholder="t('admin.pages.slugPlaceholder')"
              class="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            >
          </div>
        </div>
        <div>
          <label class="block text-sm text-gray-600 dark:text-gray-300 mb-1" for="page-content">
            {{ t("admin.pages.contentLabel") }}
          </label>
          <textarea
            id="page-content"
            v-model="newForm.content"
            rows="6"
            :placeholder="t('admin.pages.contentPlaceholder')"
            class="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors font-mono text-sm"
          />
        </div>
        <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
          <input id="page-publish" v-model="newForm.published" type="checkbox" class="rounded">
          {{ t("admin.pages.publishLabel") }}
        </label>
        <button
          type="submit"
          :disabled="!newForm.title.trim() || isProcessing"
          class="px-6 py-3 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors"
        >
          {{ t("admin.pages.create") }}
        </button>
      </form>
    </div>

    <!-- Pages list -->
    <div v-if="pending" class="text-center py-12">
      <Icon icon="lucide:loader-2" class="w-5 h-5 animate-spin inline-block mr-2" />
      {{ t("admin.pages.loading") }}
    </div>
    <div v-else-if="error" class="text-center py-12 text-gray-500">
      {{ t("admin.pages.loadFailed") }}
    </div>
    <div v-else-if="!pages?.length" class="text-center py-12 text-gray-500">
      {{ t("admin.pages.empty") }}
    </div>
    <div v-else class="space-y-3">
      <div
        v-for="p in pages"
        :key="p.id"
        class="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-4"
      >
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <NuxtLink
                v-if="p.published"
                :to="`/pages/${p.slug}`"
                target="_blank"
                rel="noopener"
                class="font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 truncate"
              >
                {{ p.title }}
              </NuxtLink>
              <span v-else class="font-medium text-gray-900 dark:text-gray-100 truncate">{{ p.title }}</span>
              <span
                :class="p.published
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'"
                class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0"
              >
                {{ p.published ? t("admin.pages.published") : t("admin.pages.draft") }}
              </span>
            </div>
            <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">/pages/{{ p.slug }}</p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button
              type="button"
              class="px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              @click="togglePublished(p)"
            >
              {{ p.published ? t("admin.pages.unpublish") : t("admin.pages.publish") }}
            </button>
            <button
              type="button"
              class="px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              @click="editingId === p.id ? cancelEdit() : startEdit(p)"
            >
              {{ editingId === p.id ? t("admin.pages.cancel") : t("admin.pages.edit") }}
            </button>
            <button
              type="button"
              class="px-3 py-1.5 rounded-lg text-sm font-medium border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              @click="handleDelete(p.id)"
            >
              {{ t("admin.pages.delete") }}
            </button>
          </div>
        </div>

        <!-- Inline editor -->
        <div v-if="editingId === p.id" class="mt-4 space-y-4 border-t border-gray-100 dark:border-gray-800 pt-4">
          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label class="block text-sm text-gray-600 dark:text-gray-300 mb-1" :for="`edit-page-title-${p.id}`">
                {{ t("admin.pages.titleLabel") }}
              </label>
              <input
                :id="`edit-page-title-${p.id}`"
                v-model="editingForm.title"
                type="text"
                class="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
              >
            </div>
            <div>
              <label class="block text-sm text-gray-600 dark:text-gray-300 mb-1" :for="`edit-page-slug-${p.id}`">
                {{ t("admin.pages.slugLabel") }}
              </label>
              <input
                :id="`edit-page-slug-${p.id}`"
                v-model="editingForm.slug"
                type="text"
                class="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
              >
            </div>
          </div>
          <div>
            <label class="block text-sm text-gray-600 dark:text-gray-300 mb-1" :for="`edit-page-content-${p.id}`">
              {{ t("admin.pages.contentLabel") }}
            </label>
            <textarea
              :id="`edit-page-content-${p.id}`"
              v-model="editingForm.content"
              rows="8"
              class="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors font-mono text-sm"
            />
          </div>
          <div class="flex items-center gap-4">
            <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
              <input :id="`edit-page-publish-${p.id}`" v-model="editingForm.published" type="checkbox" class="rounded">
              {{ t("admin.pages.publishLabel") }}
            </label>
            <button
              type="button"
              class="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors"
              :disabled="!editingForm.title.trim() || isProcessing"
              @click="confirmEdit(p.id)"
            >
              {{ t("admin.pages.save") }}
            </button>
            <button
              type="button"
              class="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              @click="cancelEdit"
            >
              {{ t("admin.pages.cancel") }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
