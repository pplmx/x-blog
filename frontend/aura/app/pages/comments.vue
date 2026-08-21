<script setup lang="ts">
/**
 * The signed-in reader's own comment history — "my comments" (DEC-066,
 * TASK-140).
 *
 * A moderated blog hides pending/rejected comments from everyone but their
 * author; this page shows the caller's comments with a derived moderation
 * status (pending / approved / rejected), a link back to each thread, and a
 * delete action scoped to the caller's own comment. Logged-out visitors see a
 * sign-in prompt instead (no server-side guard: reader auth is localStorage).
 */
import type { MyComment, MyCommentListResponse } from "~~/composables/useApi";
import { deleteMyComment, fetchMyComments } from "~~/composables/useApi";
import { useReaderAuth } from "~~/composables/useReaderAuth";
import { useSeo } from "~~/composables/useSeo";

const { t, locale } = useLang();
const { isAuthenticated } = useReaderAuth();

useSeo({
	title: t("myComments.seoTitle"),
	description: t("myComments.seoDesc"),
	path: "/comments",
});

// Load on mount (not async setup, so the page is testable and SSR-hydration
// friendly; reader auth is localStorage-only). fetchMyComments uses $fetch so
// `await` really waits for the response (no useFetch race).
const commentData = ref<MyCommentListResponse | null>(null);
const loading = ref(true);

async function load() {
	try {
		commentData.value = await fetchMyComments();
	} catch {
		// Missing/invalid token, offline, etc — the signed-in check gates the
		// page; any failure just leaves the empty state.
		commentData.value = null;
	}
	loading.value = false;
}

onMounted(() => {
	void load();
});

const comments = computed(() => commentData.value?.items || []);
const total = computed(() => commentData.value?.total || 0);

const deleting = ref<number | null>(null);
const deleteFailed = ref(false);

async function removeComment(comment: MyComment) {
	if (!confirm(t("myComments.deleteConfirm"))) return;
	deleting.value = comment.id;
	deleteFailed.value = false;
	try {
		await deleteMyComment(comment.id);
	} catch {
		deleteFailed.value = true;
		deleting.value = null;
		return;
	}
	deleting.value = null;
	await load();
}

const statusIcon = (status: MyComment["status"]): string =>
	status === "approved"
		? "lucide:check-circle"
		: status === "rejected"
			? "lucide:x-circle"
			: "lucide:clock";

const statusClasses: Record<MyComment["status"], string> = {
	approved: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300",
	pending: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300",
	rejected: "bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400",
};

function formatDate(dateStr: string): string {
	return new Date(dateStr).toLocaleDateString(locale.value === "zh" ? "zh-CN" : "en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-12">
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1
          class="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent"
        >
          {{ t('myComments.title') }}
        </h1>
        <p v-if="total > 0" class="text-sm text-gray-500 dark:text-gray-400 mt-2">
          {{ t('myComments.countLabel', { count: total }) }}
        </p>
      </div>
    </div>

    <!-- Logged out: this page is reader-scoped, prompt to sign in -->
    <div
      v-if="!isAuthenticated"
      class="text-center py-12 text-gray-500 dark:text-gray-400 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl"
    >
      <p class="mb-3">{{ t('myComments.signInPrompt') }}</p>
      <NuxtLink
        to="/login"
        class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
      >
        <Icon icon="lucide:log-in" class="w-4 h-4" />
        {{ t('myComments.signInLink') }}
      </NuxtLink>
    </div>

    <!-- Loading -->
    <div v-else-if="loading" class="space-y-3">
      <div v-for="i in 3" :key="i" class="animate-pulse">
        <div class="bg-gray-200 dark:bg-gray-700 h-4 rounded w-3/4 mb-2" />
        <div class="bg-gray-200 dark:bg-gray-700 h-3 rounded w-1/2" />
      </div>
    </div>

    <!-- Empty -->
    <div
      v-else-if="comments.length === 0"
      class="text-center py-12 text-gray-500 dark:text-gray-400 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl"
    >
      <p class="mb-3">{{ t('myComments.empty') }}</p>
      <NuxtLink
        to="/"
        class="text-sm text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
      >
        {{ t('myComments.browse') }}
      </NuxtLink>
    </div>

    <!-- Comment list -->
    <ul v-else class="space-y-3">
      <li
        v-for="comment in comments"
        :key="comment.id"
        class="border border-gray-100 dark:border-gray-700 rounded-lg p-4"
      >
        <div class="flex items-center gap-2 mb-1">
          <span
            class="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium"
            :class="statusClasses[comment.status]"
            :title="t(`myComments.statusTitle.${comment.status}`)"
          >
            <Icon :icon="statusIcon(comment.status)" class="w-3 h-3" />
            {{ t(`myComments.status.${comment.status}`) }}
          </span>
          <span class="text-xs text-gray-500 dark:text-gray-400">{{ formatDate(comment.created_at) }}</span>
        </div>

        <p class="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap mb-2">{{ comment.content }}</p>

        <div class="flex items-center justify-between">
          <NuxtLink
            v-if="comment.post"
            :to="`/posts/${comment.post.slug}`"
            class="text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 transition-colors truncate"
          >
            {{ t('myComments.onPost', { title: comment.post.title }) }}
          </NuxtLink>
          <span v-else class="text-xs text-gray-400">{{ t('myComments.onPost', { title: '—' }) }}</span>

          <button
            type="button"
            :disabled="deleting === comment.id"
            class="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
            @click="removeComment(comment)"
          >
            <Icon icon="lucide:trash-2" class="w-3.5 h-3.5" />
            {{ t('myComments.delete') }}
          </button>
        </div>
      </li>
    </ul>

    <p v-if="deleteFailed" class="mt-3 text-sm text-red-500 dark:text-red-400">
      {{ t('myComments.deleteFailed') }}
    </p>
  </div>
</template>
