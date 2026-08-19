<template>
  <section>
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-xl font-bold text-gray-900 dark:text-gray-100">{{ t('components.commentList.title') }} ({{ total }})</h2>
    </div>

    <!-- Loading -->
    <div v-if="pending" class="space-y-3">
      <div v-for="i in 3" :key="i" class="animate-pulse">
        <div class="bg-gray-200 dark:bg-gray-700 h-4 rounded w-3/4 mb-2" />
        <div class="bg-gray-200 dark:bg-gray-700 h-3 rounded w-1/2" />
      </div>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="comments.length === 0"
      class="text-center py-8 text-gray-500 dark:text-gray-400"
    >
      {{ t('components.commentList.empty') }}
    </div>

    <!-- Comment list -->
    <ul v-else class="space-y-4">
      <li
        v-for="comment in topLevelComments"
        :key="comment.id"
        class="border border-gray-100 dark:border-gray-700 rounded-lg p-3"
      >
        <div class="flex items-start gap-2">
          <div class="flex-1">
            <div class="flex items-center gap-2 mb-1">
              <span class="font-medium text-sm text-gray-900 dark:text-gray-100">{{ comment.nickname }}</span>
              <span
                v-if="comment.reader"
                class="inline-flex items-center gap-0.5 text-[11px] text-blue-600 dark:text-blue-400"
                :title="t('components.commentList.verifiedReader')"
              >
                <Icon icon="lucide:badge-check" class="w-3.5 h-3.5" />
                <span v-if="comment.reader.display_name && comment.reader.display_name !== comment.nickname">
                  {{ comment.reader.display_name }}
                </span>
              </span>
              <span class="text-xs text-gray-500 dark:text-gray-400">{{ formatDate(comment.created_at) }}</span>
            </div>
            <p class="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{{ comment.content }}</p>

            <button
              type="button"
              class="mt-2 text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
              @click="toggleReply(comment)"
            >
              {{ replyTo?.id === comment.id ? t('components.commentList.cancelReply') : t('components.commentList.reply') }}
            </button>

            <!-- Inline reply form -->
            <div v-if="replyTo?.id === comment.id" class="mt-3">
              <CommentForm
                :post-id="props.postId"
                :parent-id="comment.id"
                :replying-to="comment.nickname"
                :submit-label="t('components.commentList.reply')"
                @submitted="handleReplied"
                @cancel="replyTo = null"
              />
            </div>
          </div>
        </div>

        <!-- Nested replies (all descendants, incl. replies-to-replies) -->
        <ul v-if="descendantsOf(comment.id).length" class="mt-3 space-y-3 pl-4 border-l-2 border-gray-200 dark:border-gray-700">
          <li
            v-for="reply in descendantsOf(comment.id)"
            :key="reply.id"
            class="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3"
          >
            <div class="flex items-center gap-2 mb-1">
              <span v-if="reply.parent_id !== comment.id" class="text-xs text-gray-400 -mr-1">
                <Icon icon="lucide:corner-down-right" class="w-3 h-3 inline" />
              </span>
              <span class="font-medium text-sm text-gray-900 dark:text-gray-100">{{ reply.nickname }}</span>
              <span
                v-if="reply.reader"
                class="text-[11px] text-blue-600 dark:text-blue-400"
                :title="t('components.commentList.verifiedReader')"
              >
                <Icon icon="lucide:badge-check" class="w-3.5 h-3.5 inline" />
              </span>
              <span class="text-xs text-gray-500 dark:text-gray-400">{{ formatDate(reply.created_at) }}</span>
            </div>
            <p class="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{{ reply.content }}</p>

            <button
              type="button"
              class="mt-2 text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
              @click="toggleReply(reply)"
            >
              {{ replyTo?.id === reply.id ? t('components.commentList.cancelReply') : t('components.commentList.reply') }}
            </button>

            <!-- Inline reply form for this reply (reply-to-reply, RIL TASK-080) -->
            <div v-if="replyTo?.id === reply.id" class="mt-3">
              <CommentForm
                :post-id="props.postId"
                :parent-id="reply.id"
                :replying-to="reply.nickname"
                :submit-label="t('components.commentList.reply')"
                @submitted="handleReplied"
                @cancel="replyTo = null"
              />
            </div>
          </li>
        </ul>
      </li>
    </ul>

    <!-- Pagination -->
    <nav
      v-if="totalPages > 1"
      class="flex justify-center gap-2 mt-6"
    >
      <button
        type="button"
        v-for="page in visiblePages"
        :key="page"
        @click="loadPage(page)"
        :class="[
          'px-3 py-1 rounded text-sm',
          page === currentPage
            ? 'bg-blue-600 text-white'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700',
        ]"
      >
        {{ page }}
      </button>
    </nav>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { type Comment, fetchComments } from "~~/composables/useApi";
import CommentForm from "./CommentForm.vue";

interface Props {
	postId: number;
}

const props = defineProps<Props>();

const { t, locale } = useLang();

const { data: commentData, pending } = await fetchComments(props.postId, 1, 20);

const comments = computed(() => commentData.value?.items || []);
const total = computed(() => commentData.value?.total || 0);
const totalPages = computed(() => commentData.value?.total_pages || 0);
const currentPage = ref(1);

// Thread the paginated flat list into a tree: group children by parent_id,
// then render top-level comments (parent_id null, or whose parent is not on
// the current page) with all their nested descendants. Walking the ancestor
// chain means replies-to-replies stay under their top-level comment instead of
// being dropped (RIL ISS-037).
const byId = computed(() => {
	const m = new Map<number, Comment>();
	for (const c of comments.value) m.set(c.id, c);
	return m;
});
const childrenByParent = computed(() => {
	const m = new Map<number, Comment[]>();
	for (const c of comments.value) {
		if (c.parent_id !== null) {
			const list = m.get(c.parent_id) ?? [];
			list.push(c);
			m.set(c.parent_id, list);
		}
	}
	return m;
});

// Top-level = no parent, or the parent isn't present on this page (it would
// otherwise nest under a comment we can't render above it).
const topLevelComments = computed(() =>
	comments.value.filter((c) => c.parent_id === null || !byId.value.has(c.parent_id ?? -1)),
);

function descendantsOf(commentId: number): Comment[] {
	const direct = childrenByParent.value.get(commentId) ?? [];
	const nested: Comment[] = [];
	for (const c of direct) {
		nested.push(c);
		nested.push(...descendantsOf(c.id));
	}
	return nested;
}

// Expand a top-level comment into itself plus its nested replies (one level).
const replyTo = ref<{ id: number; nickname: string } | null>(null);

function toggleReply(comment: Comment) {
	replyTo.value =
		replyTo.value?.id === comment.id ? null : { id: comment.id, nickname: comment.nickname };
}

async function refreshList() {
	commentData.value = (await fetchComments(props.postId, currentPage.value, 20)).data.value;
}

async function handleReplied() {
	await refreshList();
	replyTo.value = null;
}

const visiblePages = computed(() => {
	const pages = [];
	const maxVisible = 5;
	let start = Math.max(1, currentPage.value - Math.floor(maxVisible / 2));
	let end = Math.min(totalPages.value, start + maxVisible - 1);
	start = Math.max(1, end - maxVisible + 1);
	for (let i = start; i <= end; i++) {
		pages.push(i);
	}
	return pages;
});

async function loadPage(page: number) {
	currentPage.value = page;
	await refreshList();
}

function formatDate(dateStr: string): string {
	return new Date(dateStr).toLocaleDateString(locale.value === "zh" ? "zh-CN" : "en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}
</script>
