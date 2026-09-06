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
import type {
	MyComment,
	MyCommentListResponse,
	MyCommentStatusFilter,
} from "~~/api/reader/comments";
import { deleteMyComment, getMyComments } from "~~/api/reader/comments";
import { parseApiDate } from "~~/composables/apiDate";
import { paginationPages } from "~~/composables/usePagination";
import { useReaderAuth } from "~~/composables/useReaderAuth";
import { useSeo } from "~~/composables/useSeo";

const { t, locale } = useLang();
const { isAuthenticated, logout, isStaleSession } = useReaderAuth();

// Getter form: an in-app language switch re-evaluates the title/OG tags,
// which a static object would have frozen in the initial language (same
// reason every other page passes a getter — deep-dive, ISS-371).
useSeo(() => ({
	title: t("myComments.seoTitle"),
	description: t("myComments.seoDesc"),
	path: "/comments",
}));

// Load on mount (not async setup, so the page is testable and SSR-hydration
// friendly; reader auth is localStorage-only). getMyComments uses $fetch so
// `await` really waits for the response (no useFetch race).
const commentData = ref<MyCommentListResponse | null>(null);
const loading = ref(true);
const loadFailed = ref(false);
// Status filter + pagination (DEC-102, TASK-163).
const statusFilter = ref<MyCommentStatusFilter>("all");
const currentPage = ref(1);

// Monotonic request sequence so a slow earlier response (e.g. a page-2 fetch)
// cannot overwrite a newer filter tab's data after a fast response landed. Same
// guard as useReadingHistory's recall-search (ISS-128) and HeaderSearch.
let loadSeq = 0;

/**
 * Route a stale reader session (expired/revoked token → the backend's 401 with
 * the auth-dependency detail) to sign-in instead of a misleading network error
 * whose Retry can never succeed, while the page still looks signed-in. Any
 * other failure just marks the target failed. Same handling as account.vue and
 * notifications.vue (ISS-110); the reader shows the sign-in prompt mid-route.
 */
function handleLoadFailure(err: unknown, markFailed: () => void): void {
	if (isStaleSession(err)) {
		logout();
		void navigateTo("/login");
		return;
	}
	markFailed();
}

async function load() {
	// Guests see the in-page sign-in prompt — do not fire an authenticated
	// request (the resulting 401 would otherwise race the prompt into a
	// redirect to /login, stealing the reader's intended post-login landing;
	// mirror notifications/account, ISS-383).
	if (!isAuthenticated.value) return;
	const seq = ++loadSeq; // invalidate any in-flight older request
	// Re-enter loading on refetch (tab/page change) so the swap is visible, and
	// keep errors distinct from a genuinely empty list (ISS-129).
	loading.value = true;
	loadFailed.value = false;
	try {
		const data = await getMyComments(statusFilter.value, currentPage.value, 20);
		if (seq !== loadSeq) return; // stale response — a newer filter/page is in flight
		// Deleting the last comment of the last page drains it: an empty page
		// under a non-zero total must clamp back to the last valid page instead
		// of showing a fake "You haven't commented yet" under a stale count
		// (same drain-clamp as CommentList, deep-dive finding).
		if (data.items.length === 0 && data.total > 0) {
			const last = Math.max(1, data.total_pages || 1);
			if (currentPage.value !== last) {
				currentPage.value = last;
				return load(); // bounded: the last page resolves with items or is terminal
			}
		}
		commentData.value = data;
	} catch (err) {
		if (seq !== loadSeq) return;
		// A dead session must not present as "network error": log out and go to
		// /login. Missing token, offline, etc — signal failure instead of
		// pretending the list is empty (ISS-129).
		commentData.value = null;
		handleLoadFailure(err, () => {
			loadFailed.value = true;
		});
	}
	if (seq === loadSeq) loading.value = false;
}

onMounted(() => {
	void load();
});

const comments = computed(() => commentData.value?.items || []);
const total = computed(() => commentData.value?.total || 0);
const totalPages = computed(() => commentData.value?.total_pages || 0);

// Windowed, ellipsis-aware page tokens (first / current-window / last joined
// by "…"), matching the archive/search/category/tag feeds — the previous
// hand-rolled 5-window had no far-page affordance, so deep comment history
// offered no way to jump to the first/last page without walking the window
// (survey finding #4, round 265).
const paginationTokens = computed(() => paginationPages(totalPages.value, currentPage.value));

function setStatus(status: MyCommentStatusFilter): void {
	if (status === statusFilter.value) return;
	statusFilter.value = status;
	currentPage.value = 1;
	void load();
}

function goToPage(page: number | "…"): void {
	if (typeof page !== "number" || page === currentPage.value) return;
	currentPage.value = page;
	void load();
}

// The rows whose delete is in flight, tracked per-row so two comments can be
// deleted at once without clearing each other's in-flight marker (a single
// `deleting` slot let the second delete re-enable the first row's button
// mid-request — same class of race as the bookmark-folder assign, deep-dive).
const deletingIds = ref<Set<number>>(new Set());
const deleteFailed = ref(false);

async function removeComment(comment: MyComment) {
	if (!confirm(t("myComments.deleteConfirm"))) return;
	if (deletingIds.value.has(comment.id)) return; // single-flight per row
	deletingIds.value.add(comment.id);
	deleteFailed.value = false;
	try {
		await deleteMyComment(comment.id);
	} catch (err) {
		handleLoadFailure(err, () => {
			deleteFailed.value = true;
		});
		return;
	} finally {
		deletingIds.value.delete(comment.id);
	}
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
	return (
		parseApiDate(dateStr)?.toLocaleDateString(locale.value === "zh" ? "zh-CN" : "en-US", {
			year: "numeric",
			month: "short",
			day: "numeric",
		}) ?? ""
	);
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
        <p v-if="isAuthenticated && total > 0" class="text-sm text-gray-500 dark:text-gray-400 mt-2">
          {{ t('myComments.countLabel', { count: total }) }}
        </p>
      </div>
    </div>

    <!-- Status filter buttons (DEC-102, TASK-163). These are mutually
         exclusive filter buttons, not a roving-tabindex tablist — plain
         buttons with aria-pressed is the honest semantics (a fake role="tab"
         promised arrow-key navigation the buttons don't implement). -->
    <div
      v-if="isAuthenticated && !loading"
      class="flex items-center gap-2 mb-6 flex-wrap"
    >
      <button
        v-for="status in (['all', 'pending', 'approved', 'rejected'] as const)"
        :key="status"
        type="button"
        :aria-pressed="statusFilter === status"
        :class="[
          'px-3 py-1 rounded-full text-sm transition-colors',
          statusFilter === status
            ? 'bg-blue-600 text-white'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700',
        ]"
        @click="setStatus(status)"
      >
        {{ t(`myComments.filter.${status}`) }}
      </button>
    </div>

    <!-- Logged out: this page is reader-scoped, prompt to sign in -->
    <div
      v-if="!isAuthenticated"
      class="text-center py-12 text-gray-500 dark:text-gray-400 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl"
    >
      <p class="mb-3">{{ t('myComments.signInPrompt') }}</p>
      <NuxtLink
        :to="{ path: '/login', query: { redirect: '/comments' } }"
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

    <!-- Error (distinct from an empty list, ISS-129) -->
    <div
      v-else-if="loadFailed"
      class="text-center py-12 text-gray-500 dark:text-gray-400 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl"
    >
      <p class="mb-3">{{ t('common.errors.network') }}</p>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        @click="void load()"
      >
        <Icon icon="lucide:refresh-cw" class="w-4 h-4" />
        {{ t('common.action.retry') }}
      </button>
    </div>

    <!-- Empty: a non-'all' filter that returns zero must not claim the reader
         has "never commented" — it's this filter that has nothing. Per-filter
         copy plus a one-click reset to the full list (ISS-385). Only the
         genuinely-empty 'all' view keeps the browse-to-posts CTA. -->
    <div
      v-else-if="comments.length === 0"
      class="text-center py-12 text-gray-500 dark:text-gray-400 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl"
    >
      <template v-if="statusFilter !== 'all'">
        <p class="mb-3">
          {{ t('myComments.emptyFilter', { status: t(`myComments.filter.${statusFilter}`) }) }}
        </p>
        <button
          type="button"
          class="text-sm text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
          @click="setStatus('all')"
        >
          {{ t('myComments.showAll') }}
        </button>
      </template>
      <template v-else>
        <p class="mb-3">{{ t('myComments.empty') }}</p>
        <NuxtLink
          to="/"
          class="text-sm text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
        >
          {{ t('myComments.browse') }}
        </NuxtLink>
      </template>
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
            :disabled="deletingIds.has(comment.id)"
            :aria-busy="deletingIds.has(comment.id)"
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

    <!-- Pagination (DEC-102, TASK-163; round 265: shared first/last + ellipsis
         tokens like the archive/search feeds, so deep history can reach the
         far pages instead of a fixed local window) -->
    <nav v-if="isAuthenticated && totalPages > 1" class="flex justify-center gap-2 mt-6">
      <button
        type="button"
        v-for="(pg, i) in paginationTokens"
        :key="pg === '…' ? `ellipsis-${i}` : pg"
        :disabled="pg === '…' || pg === currentPage"
        :aria-current="pg !== '…' && pg === currentPage ? 'page' : undefined"
        :class="[
          'px-3 py-1 rounded text-sm',
          pg === '…'
            ? 'cursor-default text-gray-400'
            : pg === currentPage
              ? 'bg-blue-600 text-white cursor-default'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700',
        ]"
        @click="pg !== '…' && pg !== currentPage && goToPage(pg)"
      >
        {{ pg }}
      </button>
    </nav>
  </div>
</template>
