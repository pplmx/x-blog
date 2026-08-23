<!--
  Admin Series Page
  Manage post series (DEC-056/TASK-123): create, rename, re-slug, describe,
  and delete series. Deleting a series unlinks its posts (which keep existing).
  Mirrors the admin categories page.
-->
<script setup lang="ts">
import { ref } from "vue";
import {
	createAdminSeries,
	deleteAdminSeries,
	fetchAdminSeries,
	fetchAdminSeriesEpisodes,
	reorderAdminSeriesEpisodes,
	type SeriesEpisode,
	updateAdminSeries,
} from "~~/composables/useApi";

definePageMeta({ layout: "admin" });

const { t } = useLang();

useHead({ title: computed(() => t("admin.series.seoTitle")) });

const { data: series, pending, error, refresh } = await fetchAdminSeries();
const isProcessing = ref(false);
const actionError = ref<string | null>(null);

const newForm = ref({
	title: "",
	slug: "",
	description: "",
});
const editingId = ref<number | null>(null);
const editingForm = ref({
	title: "",
	slug: "",
	description: "",
});

// Episode management (DEC-146/TASK-185): expand a series to see its posts in
// order and reorder them with up/down, persisted via the reorder endpoint.
const openEpisodesId = ref<number | null>(null);
const episodesBySeries = ref<Record<number, SeriesEpisode[]>>({});
const episodesLoading = ref(false);
const episodesError = ref(false);

async function toggleEpisodes(s: { id: number }) {
	episodesError.value = false;
	if (openEpisodesId.value === s.id) {
		openEpisodesId.value = null;
		return;
	}
	openEpisodesId.value = s.id;
	if (episodesBySeries.value[s.id]) return;
	episodesLoading.value = true;
	try {
		const res = await fetchAdminSeriesEpisodes(s.id);
		episodesBySeries.value[s.id] = res.data?.value ?? [];
	} catch {
		episodesBySeries.value[s.id] = [];
		episodesError.value = true;
	} finally {
		episodesLoading.value = false;
	}
}

async function moveEpisode(seriesId: number, index: number, dir: -1 | 1) {
	const current = episodesBySeries.value[seriesId] ?? [];
	const target = index + dir;
	if (target < 0 || target >= current.length) return;
	const next = [...current];
	const [item] = next.splice(index, 1);
	next.splice(target, 0, item);
	episodesError.value = false;
	try {
		const res = await reorderAdminSeriesEpisodes(
			seriesId,
			next.map((e) => e.id),
		);
		episodesBySeries.value[seriesId] = res.data?.value ?? next;
	} catch {
		episodesError.value = true;
	}
}

function getErrorMessage(e: unknown): string {
	if (e instanceof Error) return e.message;
	return t("admin.series.operationFailed");
}

function generateSlug(title: string): string {
	let slug = title
		.toLowerCase()
		.replace(/[^\w\s-]/g, "")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "")
		.trim();
	// ASCII-only `\w` strips CJK — fall back to a deterministic ASCII slug so
	// a pure-CJK series title still saves (mirrors the post editor, TASK-106).
	if (!slug) {
		let hash = 0;
		for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) & 0x7fffffff;
		slug = `series-${hash.toString(36)}`;
	}
	return slug;
}

async function handleCreate() {
	if (!newForm.value.title.trim()) return;
	isProcessing.value = true;
	actionError.value = null;
	try {
		const payload = {
			title: newForm.value.title.trim(),
			slug: newForm.value.slug.trim() || generateSlug(newForm.value.title.trim()),
			description: newForm.value.description.trim() || null,
		};
		const result = await createAdminSeries(payload);
		if (result.error.value) {
			const err = result.error.value as { data?: { detail?: string | { msg?: string }[] } } | null;
			actionError.value =
				typeof err?.data?.detail === "string" ? err.data.detail : t("admin.series.operationFailed");
		} else {
			newForm.value = { title: "", slug: "", description: "" };
			await refresh();
		}
	} catch (e) {
		actionError.value = getErrorMessage(e);
	} finally {
		isProcessing.value = false;
	}
}

function startEdit(s: { id: number; title: string; slug: string; description: string | null }) {
	editingId.value = s.id;
	editingForm.value = {
		title: s.title,
		slug: s.slug,
		description: s.description || "",
	};
}

async function confirmEdit(id: number) {
	if (!editingForm.value.title.trim()) return;
	isProcessing.value = true;
	actionError.value = null;
	try {
		const payload = {
			title: editingForm.value.title.trim(),
			slug: editingForm.value.slug.trim(),
			description: editingForm.value.description.trim() || null,
		};
		const result = await updateAdminSeries(id, payload);
		if (result.error.value) {
			const err = result.error.value as { data?: { detail?: string | { msg?: string }[] } } | null;
			actionError.value =
				typeof err?.data?.detail === "string" ? err.data.detail : t("admin.series.operationFailed");
		} else {
			editingId.value = null;
			await refresh();
		}
	} catch (e) {
		actionError.value = getErrorMessage(e);
	} finally {
		isProcessing.value = false;
	}
}

async function handleDelete(id: number) {
	if (!confirm(t("admin.series.confirmDelete"))) return;
	isProcessing.value = true;
	actionError.value = null;
	try {
		await deleteAdminSeries(id);
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
        {{ t("admin.series.title") }}
      </h1>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
        {{ t("admin.series.summary", { n: series?.length || 0 }) }}
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
        {{ t("admin.series.createTitle") }}
      </h2>
      <div class="space-y-3">
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
          <span class="mb-1 inline-block">{{ t("admin.series.titleLabel") }}</span>
          <input
            v-model="newForm.title"
            type="text"
            :placeholder="t('admin.series.titlePlaceholder')"
            class="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
        </label>
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
          <span class="mb-1 inline-block">{{ t("admin.series.slugLabel") }}</span>
          <div class="flex gap-2">
            <input
              v-model="newForm.slug"
              type="text"
              :placeholder="t('admin.series.slugPlaceholder')"
              class="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            >
            <button
              type="button"
              class="px-3 py-2 text-xs text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors shrink-0"
              @click="newForm.slug = generateSlug(newForm.title || '')"
            >
              {{ t("admin.postEdit.autoSlug") }}
            </button>
          </div>
        </label>
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
          <span class="mb-1 inline-block">{{ t("admin.series.descriptionLabel") }}</span>
          <textarea
            v-model="newForm.description"
            rows="2"
            :placeholder="t('admin.series.descriptionPlaceholder')"
            class="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors resize-none"
          />
        </label>
        <button
          type="button"
          :disabled="!newForm.title.trim() || isProcessing"
          class="px-6 py-3 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors"
          @click="handleCreate"
        >
          {{ t("admin.series.create") }}
        </button>
      </div>
    </div>

    <!-- Series list -->
    <div v-if="pending" class="text-center py-12">
      <Icon icon="lucide:loader-2" class="w-5 h-5 animate-spin inline-block mr-2" />
      {{ t("admin.series.loading") }}
    </div>

    <div v-else-if="error" class="text-center py-12 text-red-500">
      {{ error?.message || String(error) }}
    </div>

    <div
      v-else-if="!series || series.length === 0"
      class="text-center py-16 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800"
    >
      <Icon icon="lucide:layers" class="w-12 h-12 text-gray-400 mb-4 mx-auto" />
      <p class="text-gray-500 dark:text-gray-400">
        {{ t("admin.series.empty") }}
      </p>
    </div>

    <div
      v-else
      class="space-y-3"
    >
      <div
        v-for="s in series"
        :key="s.id"
        class="p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800"
      >
        <!-- Inline edit form -->
        <div v-if="editingId === s.id" class="space-y-3">
          <div class="flex gap-3">
            <input
              v-model="editingForm.title"
              type="text"
              :placeholder="t('admin.series.titlePlaceholder')"
              class="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
            <input
              v-model="editingForm.slug"
              type="text"
              :placeholder="t('admin.series.slugPlaceholder')"
              class="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
          </div>
          <textarea
            v-model="editingForm.description"
            rows="2"
            :placeholder="t('admin.series.descriptionPlaceholder')"
            class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="px-3 py-1.5 text-sm text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg transition-colors"
              @click="confirmEdit(s.id)"
            >
              {{ t("admin.series.confirm") }}
            </button>
            <button
              type="button"
              class="px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
              @click="editingId = null"
            >
              {{ t("common.action.cancel") }}
            </button>
          </div>
        </div>

        <!-- Read view -->
        <div v-else>
          <div class="flex items-start justify-between gap-4">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-3 flex-wrap">
                <span class="text-gray-900 dark:text-gray-100 font-medium">{{ s.title }}</span>
                <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                  {{ t("admin.series.postsLabel", { count: s.post_count ?? 0 }) }}
                </span>
              </div>
              <p v-if="s.description" class="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                {{ s.description }}
              </p>
              <p class="text-xs text-gray-400 dark:text-gray-500 mt-1 font-mono">
                /series/{{ s.slug }}
              </p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button
                type="button"
                class="px-3 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg transition-colors"
                @click="toggleEpisodes(s)"
              >
                {{ t("admin.series.episodes") }}
              </button>
              <button
                type="button"
                class="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
                @click="startEdit(s)"
              >
                {{ t("admin.series.edit") }}
              </button>
              <button
                type="button"
                :disabled="isProcessing"
                class="px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                @click="handleDelete(s.id)"
              >
                {{ t("admin.series.delete") }}
              </button>
            </div>
          </div>

          <!-- Episode manager (DEC-146/TASK-185) -->
          <div
            v-if="openEpisodesId === s.id"
            class="mt-4 border-t border-gray-100 dark:border-gray-800 pt-3"
          >
            <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
              {{ t("admin.series.episodesTitle") }}
            </p>
            <p v-if="episodesLoading" class="text-sm text-gray-400">
              {{ t("admin.series.loading") }}
            </p>
            <p v-else-if="episodesBySeries[s.id]?.length === 0" class="text-sm text-gray-400">
              {{ t("admin.series.noEpisodes") }}
            </p>
            <ul v-else class="space-y-2">
              <li
                v-for="(ep, idx) in episodesBySeries[s.id]"
                :key="ep.id"
                class="flex items-center gap-2 text-sm"
              >
                <span class="text-gray-400 w-5 text-right">{{ idx + 1 }}.</span>
                <span class="flex-1 min-w-0 truncate text-gray-700 dark:text-gray-300" :title="ep.title">
                  {{ ep.title }}
                  <span v-if="!ep.published" class="text-xs text-amber-500 ml-1">
                    {{ t("admin.series.draftBadge") }}
                  </span>
                </span>
                <button
                  type="button"
                  :disabled="idx === 0"
                  class="p-1 rounded-md text-gray-400 hover:text-indigo-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  :aria-label="t('admin.series.moveUp')"
                  @click="moveEpisode(s.id, idx, -1)"
                >
                  <Icon icon="lucide:chevron-up" class="w-4 h-4" />
                </button>
                <button
                  type="button"
                  :disabled="idx === episodesBySeries[s.id].length - 1"
                  class="p-1 rounded-md text-gray-400 hover:text-indigo-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  :aria-label="t('admin.series.moveDown')"
                  @click="moveEpisode(s.id, idx, 1)"
                >
                  <Icon icon="lucide:chevron-down" class="w-4 h-4" />
                </button>
              </li>
            </ul>
            <p v-if="episodesError" class="text-sm text-red-500 mt-2">
              {{ t("admin.series.episodeFailed") }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
