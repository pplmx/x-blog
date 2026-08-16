<script setup lang="ts">
import type { AdminPost } from "~~/composables/useApi";
import { deleteAdminPost, fetchAdminPosts } from "~~/composables/useApi";

definePageMeta({ layout: "admin" });

const { t, locale } = useLang();

useHead({ title: computed(() => t("admin.postsList.seoTitle")) });

const searchQuery = ref("");
const statusFilter = ref("");
const currentPage = ref(0);
const pageSize = 20;

const queryParams = computed(() => {
	const params: Record<string, string | number> = {
		limit: pageSize,
		skip: currentPage.value * pageSize,
	};
	if (searchQuery.value) params.q = searchQuery.value;
	if (statusFilter.value) params.status = statusFilter.value;
	return params;
});

const { data, pending, error, refresh } = await fetchAdminPosts(queryParams.value);
const posts = computed(() => data.value?.items ?? []);
const total = computed(() => data.value?.pagination?.total ?? 0);
const totalPages = computed(() => Math.ceil(total.value / pageSize));

const isDeleting = ref(false);
const debounceTimer = ref<ReturnType<typeof setTimeout> | null>(null);

watch(
	queryParams,
	() => {
		refresh();
	},
	{ deep: true },
);

function onSearchInput() {
	if (debounceTimer.value) clearTimeout(debounceTimer.value);
	debounceTimer.value = setTimeout(() => {
		currentPage.value = 0;
		refresh();
	}, 300);
}

function onStatusChange() {
	currentPage.value = 0;
	refresh();
}

async function handleDelete(id: number) {
	if (!confirm(t("admin.postsList.confirmDelete"))) return;
	isDeleting.value = true;
	try {
		await deleteAdminPost(id);
		await refresh();
	} finally {
		isDeleting.value = false;
	}
}

function statusLabel(post: AdminPost): string {
	if (!post.published && post.publish_at) return t("admin.postsList.scheduled");
	if (post.published) return t("admin.postsList.published");
	return t("admin.postsList.draft");
}

function statusColor(post: AdminPost): string {
	if (!post.published && post.publish_at)
		return "bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400";
	if (post.published) return "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400";
	return "bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400";
}

function statusDot(post: AdminPost): string {
	if (!post.published && post.publish_at) return "bg-purple-500";
	if (post.published) return "bg-green-500";
	return "bg-amber-500";
}
</script>

<template>
  <div>
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
      <div>
        <h1 class="text-2xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent">
          {{ t("admin.postsList.title") }}
        </h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {{ t("admin.postsList.summary", { n: total }) }}
        </p>
      </div>
      <NuxtLink
        to="/admin/posts/new"
        class="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-medium hover:from-blue-600 hover:to-indigo-600 shadow-md shadow-blue-500/20 transition-all"
      >
        <Icon icon="lucide:plus" class="w-4 h-4" />
        {{ t("admin.postsList.newPost") }}
      </NuxtLink>
    </div>

    <div class="flex flex-col sm:flex-row gap-3 mb-4">
      <div class="relative flex-1">
        <Icon icon="lucide:search" class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="t('admin.postsList.searchPlaceholder')"
          class="w-full pl-9 pr-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
          @input="onSearchInput"
        />
      </div>
      <select
        v-model="statusFilter"
        class="w-full sm:w-40 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
        @change="onStatusChange"
      >
        <option value="">{{ t("admin.postsList.allStatus") }}</option>
        <option value="published">{{ t("admin.postsList.published") }}</option>
        <option value="draft">{{ t("admin.postsList.draft") }}</option>
        <option value="scheduled">{{ t("admin.postsList.scheduled") }}</option>
      </select>
    </div>

    <div v-if="pending" class="text-center py-12">
      <div class="inline-flex items-center gap-2 text-gray-500">
        <svg :aria-label="t('admin.postsList.loading')" class="animate-spin w-5 h-5" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        {{ t("admin.postsList.loading") }}
      </div>
    </div>

    <div v-else-if="error" class="text-center py-12 text-red-500">
      {{ error?.message || String(error) }}
    </div>

    <div v-else-if="posts.length === 0" class="flex flex-col items-center justify-center py-16 bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800">
      <div class="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
        <Icon icon="lucide:file-text" class="w-8 h-8 text-gray-400" />
      </div>
      <h3 class="text-lg font-medium text-gray-700 dark:text-gray-300 mb-1">
        {{ searchQuery || statusFilter ? t('admin.postsList.empty.noMatchTitle') : t('admin.postsList.empty.title') }}
      </h3>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
        {{ searchQuery || statusFilter ? t('admin.postsList.empty.noMatchHint') : t('admin.postsList.empty.hint') }}
      </p>
      <NuxtLink v-if="!searchQuery && !statusFilter" to="/admin/posts/new">
        <button type="button" class="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
          <Icon icon="lucide:plus" class="w-4 h-4" />
          {{ t("admin.postsList.newPost") }}
        </button>
      </NuxtLink>
    </div>

    <div v-else class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden shadow-sm">
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="bg-gradient-to-r from-gray-50 dark:from-gray-800 to-white dark:to-gray-950 border-b border-gray-100 dark:border-gray-800">
              <th class="px-5 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t("admin.postsList.columns.title") }}</th>
              <th class="px-5 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden md:table-cell">{{ t("admin.postsList.columns.category") }}</th>
              <th class="px-5 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t("admin.postsList.columns.status") }}</th>
              <th class="px-5 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell">{{ t("admin.postsList.columns.views") }}</th>
              <th class="px-5 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell">{{ t("admin.postsList.columns.date") }}</th>
              <th class="px-5 py-4 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t("admin.postsList.columns.actions") }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50 dark:divide-gray-800">
            <tr
              v-for="post in posts"
              :key="post.id"
              class="hover:bg-gradient-to-r hover:from-blue-50/50 hover:to-indigo-50/50 dark:hover:from-blue-900/10 dark:hover:to-indigo-900/10 transition-colors"
            >
              <td class="px-5 py-4">
                <NuxtLink :to="`/admin/posts/${post.id}`" class="font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400">
                  {{ post.title }}
                </NuxtLink>
              </td>
              <td class="px-5 py-4 hidden md:table-cell">
                <span class="text-xs text-gray-500 dark:text-gray-400">{{ post.category || '-' }}</span>
              </td>
              <td class="px-5 py-4">
                <span :class="['inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium', statusColor(post)]">
                  <span :class="['w-1.5 h-1.5 rounded-full mr-1.5', statusDot(post)]" />
                  {{ statusLabel(post) }}
                </span>
              </td>
              <td class="px-5 py-4 text-sm text-gray-500 dark:text-gray-400 hidden sm:table-cell">
                {{ post.views || 0 }}
              </td>
              <td class="px-5 py-4 text-sm text-gray-500 dark:text-gray-400 hidden sm:table-cell">
                {{ new Date(post.created_at).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US") }}
              </td>
              <td class="px-5 py-4 text-right">
                <div class="flex items-center justify-end gap-1">
                  <NuxtLink :to="`/admin/posts/${post.id}`">
                    <button type="button" class="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors">
                      <Icon icon="lucide:pencil" class="h-4 w-4" />
                    </button>
                  </NuxtLink>
                  <button
                    type="button"
                    :disabled="isDeleting"
                    class="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                    @click="handleDelete(post.id)"
                  >
                    <Icon icon="lucide:trash-2" class="h-4 w-4" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="totalPages > 1" class="flex items-center justify-center gap-2 mt-6">
      <button
        type="button"
        :disabled="currentPage === 0"
        class="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        @click="currentPage--; refresh()"
      >
        {{ t("admin.postsList.pagination.prev") }}
      </button>
      <span class="text-sm text-gray-500 dark:text-gray-400">
        {{ currentPage + 1 }} / {{ totalPages }}
      </span>
      <button
        type="button"
        :disabled="currentPage >= totalPages - 1"
        class="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        @click="currentPage++; refresh()"
      >
        {{ t("admin.postsList.pagination.next") }}
      </button>
    </div>
  </div>
</template>
