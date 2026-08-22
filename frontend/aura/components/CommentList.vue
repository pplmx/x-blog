<template>
  <section ref="listEl">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-xl font-bold text-gray-900 dark:text-gray-100">{{ t('components.commentList.title') }} ({{ total }})</h2>
      <!-- Comment-thread follow (DEC-078/TASK-150): signed-in readers subscribe
           to this discussion and get a push on each newly approved comment. -->
      <ThreadSubscribeButton v-if="props.postId" :post-id="props.postId" />
    </div>
    <p v-if="likeError" class="mb-3 text-sm text-red-500">{{ likeError }}</p>
    <p v-if="actionError" class="mb-3 text-sm text-red-500">{{ actionError }}</p>

    <!-- Comment sort (DEC-094/TASK-159): reorder the thread by newest / oldest
         / most helpful (likes). Shown once there is a discussion to sort. -->
    <div v-if="total > 0" class="flex items-center justify-end gap-2 mb-3 text-sm">
      <label for="comment-sort" class="text-gray-500 dark:text-gray-400">{{ t('components.commentList.sortBy') }}</label>
      <select
        id="comment-sort"
        class="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-2 py-1"
        :value="currentSort"
        @change="onSortChange"
      >
        <option value="newest">{{ t('components.commentList.sortNewest') }}</option>
        <option value="oldest">{{ t('components.commentList.sortOldest') }}</option>
        <option value="likes">{{ t('components.commentList.sortLikes') }}</option>
      </select>
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
        :id="`comment-${comment.id}`"
        class="border border-gray-100 dark:border-gray-700 rounded-lg p-3 scroll-mt-28"
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
            <!-- Comment markdown rendering (DEC-088): sanitized via the same
                 pipeline as post content, with line breaks preserved. -->
            <div
              class="comment-body text-sm text-gray-700 dark:text-gray-300"
              v-html="commentBodyHtml(comment.content)"
            />

            <div class="mt-2 flex items-center gap-3">
              <button
                type="button"
                class="text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                @click="toggleReply(comment)"
              >
                {{ replyTo?.id === comment.id ? t('components.commentList.cancelReply') : t('components.commentList.reply') }}
              </button>
              <!-- Comment likes (DEC-092/TASK-158): anonymous upvote with a
                   localStorage dedup so one browser registers at most one like. -->
              <button
                type="button"
                class="comment-like inline-flex items-center gap-1 text-xs text-gray-500 hover:text-pink-600 dark:text-gray-400 dark:hover:text-pink-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                :disabled="likingIds.has(comment.id)"
                :title="isCommentLiked(comment.id) ? t('components.commentList.liked') : t('components.commentList.like')"
                :aria-pressed="isCommentLiked(comment.id) ? 'true' : 'false'"
                :aria-label="isCommentLiked(comment.id) ? t('components.commentList.liked') : t('components.commentList.like')"
                @click="handleCommentLike(comment)"
              >
                <Icon
                  :icon="likingIds.has(comment.id) ? 'lucide:loader-2' : 'lucide:thumbs-up'"
                  class="w-3.5 h-3.5"
                  :class="{ 'animate-spin': likingIds.has(comment.id) }"
                />
                <span class="like-count">{{ comment.likes ?? 0 }}</span>
              </button>
              <!-- Own-comment edit/delete (DEC-096, TASK-160): only the author
                   sees these; "edited" marks a self-edit. -->
              <span v-if="comment.edited_at" class="text-xs text-gray-400 dark:text-gray-500">{{ t('components.commentList.edited') }}</span>
              <template v-if="isOwnComment(comment)">
                <button
                  type="button"
                  class="comment-edit text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 transition-colors disabled:opacity-60"
                  :disabled="actionIds.has(comment.id)"
                  @click="startEdit(comment)"
                >
                  {{ t('components.commentList.edit') }}
                </button>
                <button
                  type="button"
                  class="comment-delete text-xs text-red-500 hover:text-red-700 dark:hover:text-red-300 transition-colors disabled:opacity-60"
                  :disabled="actionIds.has(comment.id)"
                  @click="confirmDelete(comment)"
                >
                  {{ t('components.commentList.delete') }}
                </button>
              </template>
            </div>

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

            <!-- Inline edit form for the author's own comment (DEC-096) -->
            <div v-if="editingId === comment.id" class="mt-3 space-y-2">
              <textarea
                v-model="editContent"
                rows="3"
                class="w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 p-2"
              ></textarea>
              <div class="flex gap-2">
                <button
                  type="button"
                  class="px-3 py-1 rounded text-sm bg-blue-600 text-white disabled:opacity-60"
                  :disabled="actionIds.has(comment.id)"
                  @click="saveEdit(comment)"
                >
                  {{ t('components.commentList.save') }}
                </button>
                <button
                  type="button"
                  class="px-3 py-1 rounded text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                  @click="cancelEdit"
                >
                  {{ t('components.commentList.cancel') }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Nested replies (all descendants, incl. replies-to-replies) -->
        <ul v-if="descendantsOf(comment.id).length" class="mt-3 space-y-3 pl-4 border-l-2 border-gray-200 dark:border-gray-700">
          <li
            v-for="reply in descendantsOf(comment.id)"
            :key="reply.id"
            :id="`comment-${reply.id}`"
            class="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 scroll-mt-28"
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
            <div
              class="comment-body text-sm text-gray-700 dark:text-gray-300"
              v-html="commentBodyHtml(reply.content)"
            />

            <div class="mt-2 flex items-center gap-3">
              <button
                type="button"
                class="text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                @click="toggleReply(reply)"
              >
                {{ replyTo?.id === reply.id ? t('components.commentList.cancelReply') : t('components.commentList.reply') }}
              </button>
              <button
                type="button"
                class="comment-like inline-flex items-center gap-1 text-xs text-gray-500 hover:text-pink-600 dark:text-gray-400 dark:hover:text-pink-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                :disabled="likingIds.has(reply.id)"
                :title="isCommentLiked(reply.id) ? t('components.commentList.liked') : t('components.commentList.like')"
                :aria-pressed="isCommentLiked(reply.id) ? 'true' : 'false'"
                :aria-label="isCommentLiked(reply.id) ? t('components.commentList.liked') : t('components.commentList.like')"
                @click="handleCommentLike(reply)"
              >
                <Icon
                  :icon="likingIds.has(reply.id) ? 'lucide:loader-2' : 'lucide:thumbs-up'"
                  class="w-3.5 h-3.5"
                  :class="{ 'animate-spin': likingIds.has(reply.id) }"
                />
                <span class="like-count">{{ reply.likes ?? 0 }}</span>
              </button>
              <span v-if="reply.edited_at" class="text-xs text-gray-400 dark:text-gray-500">{{ t('components.commentList.edited') }}</span>
              <template v-if="isOwnComment(reply)">
                <button
                  type="button"
                  class="comment-edit text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 transition-colors disabled:opacity-60"
                  :disabled="actionIds.has(reply.id)"
                  @click="startEdit(reply)"
                >
                  {{ t('components.commentList.edit') }}
                </button>
                <button
                  type="button"
                  class="comment-delete text-xs text-red-500 hover:text-red-700 dark:hover:text-red-300 transition-colors disabled:opacity-60"
                  :disabled="actionIds.has(reply.id)"
                  @click="confirmDelete(reply)"
                >
                  {{ t('components.commentList.delete') }}
                </button>
              </template>
            </div>

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

            <!-- Inline edit form for the author's own reply (DEC-096) -->
            <div v-if="editingId === reply.id" class="mt-3 space-y-2">
              <textarea
                v-model="editContent"
                rows="3"
                class="w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 p-2"
              ></textarea>
              <div class="flex gap-2">
                <button
                  type="button"
                  class="px-3 py-1 rounded text-sm bg-blue-600 text-white disabled:opacity-60"
                  :disabled="actionIds.has(reply.id)"
                  @click="saveEdit(reply)"
                >
                  {{ t('components.commentList.save') }}
                </button>
                <button
                  type="button"
                  class="px-3 py-1 rounded text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                  @click="cancelEdit"
                >
                  {{ t('components.commentList.cancel') }}
                </button>
              </div>
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
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
	type Comment,
	type CommentSort,
	deleteMyComment,
	editMyComment,
	fetchComments,
	useCommentLike,
} from "~~/composables/useApi";
import { highlightCode, loadHighlighter } from "~~/composables/useCodeHighlight";
import { commentMarkdownToHtml, loadPurify } from "~~/composables/useMarkdown";
import { useReaderAuth } from "~~/composables/useReaderAuth";
// biome-ignore lint/correctness/noUnusedImports: CommentForm is rendered in the SFC <template> (lines 59/105).
import CommentForm from "./CommentForm.vue";

// Upgrade the comments already on screen to DOMPurify once it finishes loading
// (same pattern as MarkdownContent): the regex fallback guarantees XSS-safety
// from the very first paint, and flipping purifyReady recomputes every body
// through the stronger sanitizer. (DEC-088, TASK-156)
const purifyReady = ref(false);
onMounted(async () => {
	await loadPurify();
	purifyReady.value = true;
	// The purifyReady recompute replaces comment-body HTML, wiping any earlier
	// tokens — so highlight only after that patch has applied.
	await nextTick();
	void highlightCommentCode();
});

/** Comment body HTML; recomputed per comment when DOMPurify is ready. */
function commentBodyHtml(content: string): string {
	void purifyReady.value;
	return commentMarkdownToHtml(content);
}

// Syntax highlighting for comment code blocks (DEC-090, TASK-157): the same
// lazy client-only highlight.js used for post content. Fences already render
// as <pre><code class="language-..."> from the markdown pass; tokenize each
// block once the list is on screen. highlightCode escapes its source (plain
// text fallback for unknown languages), so installing the highlighted HTML
// never weakens the v-html XSS guarantees from TASK-156.
const listEl = ref<HTMLElement | null>(null);

async function highlightCommentCode(): Promise<void> {
	if (!listEl.value) return;
	const h = await loadHighlighter();
	const blocks = listEl.value.querySelectorAll<HTMLElement>(".comment-body pre code");
	for (const el of blocks) {
		const lang = (el.className.match(/language-([\w-]+)/)?.[1] ?? "").trim();
		el.innerHTML = highlightCode(h, lang, el.textContent ?? "");
	}
}

interface Props {
	postId: number;
}

const props = defineProps<Props>();

const { t, locale } = useLang();

const { data: commentData, pending } = await fetchComments(props.postId, 1, 20);

// Deep-link landing (DEC-072): a reply notification opens /posts/<slug>#comment-<id>;
// once the list renders, scroll the anchor into view (comments carry scroll-mt
// so the sticky header doesn't cover the target).
onMounted(() => {
	if (typeof window === "undefined" || !window.location.hash.startsWith("#comment-")) return;
	const el = document.getElementById(window.location.hash.slice(1));
	if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
});

const comments = computed(() => commentData.value?.items || []);
const total = computed(() => commentData.value?.total || 0);
const totalPages = computed(() => commentData.value?.total_pages || 0);
const currentPage = ref(1);

// Comment sort (DEC-094/TASK-159): newest is the default; changing it resets
// to page 1 and re-fetches so the reorder is immediately visible.
const currentSort = ref<CommentSort>("newest");

function onSortChange(event: Event): void {
	const value = (event.target as HTMLSelectElement).value as CommentSort;
	if (value === currentSort.value) return;
	currentSort.value = value;
	currentPage.value = 1;
	void refreshList();
}

// Re-tokenize whenever the list changes (submit, pagination): the new rows
// re-render as plain <pre><code> until this re-highlights them.
watch(comments, async () => {
	await nextTick();
	void highlightCommentCode();
});

// --- Comment likes (DEC-092, TASK-158) ---

// One like per comment per browser, matching the post-like dedup (ISS-038).
const LIKED_PREFIX = "liked-comments:";
function isCommentLiked(id: number): boolean {
	if (typeof window === "undefined") return false;
	return localStorage.getItem(`${LIKED_PREFIX}${id}`) === "1";
}
function markCommentLiked(id: number): void {
	if (typeof window === "undefined") return;
	localStorage.setItem(`${LIKED_PREFIX}${id}`, "1");
}

// Comment ids with an in-flight like (spins the like icon, disables re-click).
const likingIds = ref<Set<number>>(new Set());
const likeError = ref<string | null>(null);

async function handleCommentLike(comment: Comment): Promise<void> {
	if (isCommentLiked(comment.id) || likingIds.value.has(comment.id)) return;
	likingIds.value = new Set(likingIds.value).add(comment.id);
	likeError.value = null;
	try {
		const liked = await useCommentLike(comment.id);
		// useFetch surfaces failures in `.error` (the fetch never rejects).
		if (liked.error?.value || !liked.data?.value) {
			likeError.value = t("components.commentList.likeError");
			return;
		}
		const updated = liked.data.value;
		if (typeof updated.likes === "number") {
			// Patch the flat list item — the computed tree re-renders its row
			// (top-level or nested) with the new count.
			const target = commentData.value?.items.find((c) => c.id === comment.id);
			if (target) target.likes = updated.likes;
			markCommentLiked(comment.id);
		}
	} catch {
		likeError.value = t("components.commentList.likeError");
	} finally {
		const s = new Set(likingIds.value);
		s.delete(comment.id);
		likingIds.value = s;
	}
}

// --- Comment edit/delete by the author (DEC-096, TASK-160) ---
// Only a signed-in reader who authored a comment can edit/delete it. The
// controls render only on the reader's own comments (comment.reader.id matches
// the current reader's id); anonymous comments have no owner and no controls.
const { reader } = useReaderAuth();

function isOwnComment(comment: Comment): boolean {
	const rid = reader.value?.id;
	return rid != null && comment.reader?.id === rid;
}

const editingId = ref<number | null>(null);
const editContent = ref("");
// Comment ids with an in-flight edit/delete (disables the buttons + spinner).
const actionIds = ref<Set<number>>(new Set());
const actionError = ref<string | null>(null);

function startEdit(comment: Comment): void {
	editingId.value = comment.id;
	editContent.value = comment.content;
	actionError.value = null;
}

function cancelEdit(): void {
	editingId.value = null;
	editContent.value = "";
}

async function saveEdit(comment: Comment): Promise<void> {
	const trimmed = editContent.value.trim();
	if (!trimmed || actionIds.value.has(comment.id)) return;
	actionIds.value = new Set(actionIds.value).add(comment.id);
	actionError.value = null;
	try {
		const updated = await editMyComment(comment.id, trimmed);
		const target = commentData.value?.items.find((c) => c.id === comment.id);
		if (target) {
			target.content = updated.content;
			if (updated.edited_at !== undefined) target.edited_at = updated.edited_at;
			editingId.value = null;
		}
	} catch {
		actionError.value = t("components.commentList.editError");
	} finally {
		const s = new Set(actionIds.value);
		s.delete(comment.id);
		actionIds.value = s;
	}
}

async function confirmDelete(comment: Comment): Promise<void> {
	if (actionIds.value.has(comment.id)) return;
	if (!window.confirm(t("components.commentList.deleteConfirm"))) return;
	actionIds.value = new Set(actionIds.value).add(comment.id);
	actionError.value = null;
	try {
		await deleteMyComment(comment.id);
		// Re-fetch the current page: the backend reparents any replies, and the
		// flat list + tree recompute reflects the fresh state.
		if (editingId.value === comment.id) cancelEdit();
		await refreshList();
	} catch {
		actionError.value = t("components.commentList.deleteError");
	} finally {
		const s = new Set(actionIds.value);
		s.delete(comment.id);
		actionIds.value = s;
	}
}

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
	commentData.value = (
		await fetchComments(props.postId, currentPage.value, 20, currentSort.value)
	).data.value;
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

<!-- Comment markdown typography (DEC-088): code blocks/links/quotes inside the
     sanitized comment body read like the post body, minus the heavy features. -->
<style scoped>
.comment-body :deep(pre) {
	overflow-x: auto;
	padding: 0.5rem 0.75rem;
	margin: 0.5rem 0;
	border-radius: 0.5rem;
	/* Fixed Tokyo Night code surface — the same panel as post code, so the
	   shared .hljs-* token palette stays readable in both color modes. */
	background: #1a1b26;
	color: #c0caf5;
	font-size: 0.8rem;
}
.comment-body :deep(code) {
	background: rgba(0, 0, 0, 0.06);
	padding: 0.1rem 0.3rem;
	border-radius: 0.25rem;
	font-size: 0.85em;
}
.dark .comment-body :deep(code) {
	background: rgba(255, 255, 255, 0.12);
}
.comment-body :deep(pre code) {
	background: transparent;
	padding: 0;
}
.comment-body :deep(a) {
	color: #2563eb;
	text-decoration: underline;
}
.comment-body :deep(blockquote) {
	border-left: 3px solid #d1d5db;
	padding-left: 0.75rem;
	color: #6b7280;
	margin: 0.5rem 0;
}
</style>
