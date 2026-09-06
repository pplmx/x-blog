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
    <p v-if="flagError" class="mb-3 text-sm text-red-500">{{ flagError }}</p>
    <!-- Sort/pagination refresh failures used to be silent — an offline reader
         flipped the sort arrow and saw nothing change. Surfaced + retryable. -->
    <p v-if="refreshError" role="alert" class="mb-3 flex items-center gap-2 text-sm text-red-500">
      {{ refreshError }}
      <button
        type="button"
        class="text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 underline"
        :disabled="refreshing"
        @click="retryRefresh"
      >
        {{ t('components.commentList.retry') }}
      </button>
    </p>

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
      <!-- In-flight feedback for sort/pagination refetches (pending only covers
           the initial mount; ISS-130). -->
      <Icon
        v-if="refreshing"
        icon="lucide:loader-2"
        class="w-4 h-4 animate-spin text-gray-400"
        aria-hidden="true"
        role="presentation"
      />
    </div>

    <!-- Loading -->
    <div v-if="pending" class="space-y-3">
      <div v-for="i in 3" :key="i" class="animate-pulse">
        <div class="bg-gray-200 dark:bg-gray-700 h-4 rounded w-3/4 mb-2" />
        <div class="bg-gray-200 dark:bg-gray-700 h-3 rounded w-1/2" />
      </div>
    </div>

    <!-- Initial-load failure: `useFetch`'s error, not an empty thread. A null
         data payload used to fall through to "be the first to comment!" above
         an active form (deep-dive finding); the reader gets a distinct error
         with a retry that re-runs the same initial fetch. -->
    <div
      v-else-if="initialLoadError"
      role="alert"
      class="text-center py-8 text-red-500 dark:text-red-400"
    >
      <p class="mb-3">{{ t('components.commentList.loadError') }}</p>
      <button
        type="button"
        class="text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 underline"
        :disabled="pending"
        @click="retryInitialLoad()"
      >
        {{ t('components.commentList.retry') }}
      </button>
    </div>

    <!-- Empty state: only a genuinely empty discussion says "be the first".
         An empty page under a non-zero total means deletion just drained the
         last page — refreshing clamps back to it, and the copy stays truthful. -->
    <div
      v-else-if="comments.length === 0"
      class="text-center py-8 text-gray-500 dark:text-gray-400"
    >
      {{ total === 0 ? t('components.commentList.empty') : t('components.commentList.emptyPage') }}
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
              <!-- Author reply (DEC-192): an official answer from the blog owner,
                   distinguished from a commenter so readers trust the source. -->
              <span
                v-if="comment.is_author_reply"
                class="inline-flex items-center gap-0.5 text-[11px] text-blue-600 dark:text-blue-400"
                :title="t('components.commentList.authorReply')"
              >
                <Icon icon="lucide:badge-check" class="w-3.5 h-3.5" />
                <span>{{ t("components.commentList.authorReply") }}</span>
              </span>
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
                :disabled="isCommentLiked(comment.id) || likingIds.has(comment.id)"
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
              <!-- Comment flag/report for moderation (DEC-108, TASK-166): a
                   visitor flags an inappropriate comment; one per browser. -->
              <button
                type="button"
                class="comment-flag inline-flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 hover:text-amber-600 dark:hover:text-amber-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                :disabled="isCommentFlagged(comment.id) || flaggingIds.has(comment.id)"
                :title="isCommentFlagged(comment.id) ? t('components.commentList.flagged') : t('components.commentList.flag')"
                :aria-pressed="isCommentFlagged(comment.id) ? 'true' : 'false'"
                @click="handleCommentFlag(comment)"
              >
                <Icon
                  icon="lucide:flag"
                  class="w-3.5 h-3.5"
                  :class="{ 'text-amber-500': isCommentFlagged(comment.id) }"
                />
                <span>{{ isCommentFlagged(comment.id) ? t('components.commentList.flagged') : t('components.commentList.flag') }}</span>
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
                autofocus
                @submitted="handleReplied"
                @cancel="cancelReply"
                @update:dirty="replyDirty = $event"
              />
            </div>

            <!-- Inline edit form for the author's own comment (DEC-096) -->
            <div
              v-if="editingId === comment.id"
              class="mt-3 space-y-2"
              @keydown.exact.esc.prevent="cancelEdit"
            >
              <textarea
                ref="editTextarea"
                v-model="editContent"
                rows="3"
                :aria-label="t('components.commentList.editLabel')"
                class="w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 p-2"
                @keydown.ctrl.enter.prevent="saveEdit(comment)"
                @keydown.meta.enter.prevent="saveEdit(comment)"
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
                v-if="reply.is_author_reply"
                class="text-[11px] text-blue-600 dark:text-blue-400"
                :title="t('components.commentList.authorReply')"
              >
                <Icon icon="lucide:badge-check" class="w-3.5 h-3.5 inline" />
                {{ t("components.commentList.authorReply") }}
              </span>
              <span
                v-if="reply.reader"
                class="inline-flex items-center gap-0.5 text-[11px] text-blue-600 dark:text-blue-400"
                :title="t('components.commentList.verifiedReader')"
              >
                <Icon icon="lucide:badge-check" class="w-3.5 h-3.5" />
                <span v-if="reply.reader.display_name && reply.reader.display_name !== reply.nickname">
                  {{ reply.reader.display_name }}
                </span>
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
                :disabled="isCommentLiked(reply.id) || likingIds.has(reply.id)"
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
              <button
                type="button"
                class="comment-flag inline-flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 hover:text-amber-600 dark:hover:text-amber-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                :disabled="isCommentFlagged(reply.id) || flaggingIds.has(reply.id)"
                :title="isCommentFlagged(reply.id) ? t('components.commentList.flagged') : t('components.commentList.flag')"
                :aria-pressed="isCommentFlagged(reply.id) ? 'true' : 'false'"
                @click="handleCommentFlag(reply)"
              >
                <Icon
                  icon="lucide:flag"
                  class="w-3.5 h-3.5"
                  :class="{ 'text-amber-500': isCommentFlagged(reply.id) }"
                />
                <span>{{ isCommentFlagged(reply.id) ? t('components.commentList.flagged') : t('components.commentList.flag') }}</span>
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
                autofocus
                @submitted="handleReplied"
                @cancel="cancelReply"
                @update:dirty="replyDirty = $event"
              />
            </div>

            <!-- Inline edit form for the author's own reply (DEC-096) -->
            <div
              v-if="editingId === reply.id"
              class="mt-3 space-y-2"
              @keydown.exact.esc.prevent="cancelEdit"
            >
              <textarea
                ref="editTextarea"
                v-model="editContent"
                rows="3"
                :aria-label="t('components.commentList.editLabel')"
                class="w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 p-2"
                @keydown.ctrl.enter.prevent="saveEdit(reply)"
                @keydown.meta.enter.prevent="saveEdit(reply)"
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

    <!-- Pagination (DEC-102, TASK-163; ISS-370: first/current/last + ellipsis
         like the my-comments/feed pages, so deep history can reach the far
         pages instead of a fixed local window) -->
    <nav
      v-if="totalPages > 1"
      class="flex justify-center gap-2 mt-6"
    >
      <button
        type="button"
        v-for="(pg, i) in paginationTokens"
        :key="pg === '…' ? `ellipsis-${i}` : pg"
        :disabled="pg === '…' || pg === currentPage"
        :aria-current="pg !== '…' && pg === currentPage ? 'page' : undefined"
        @click="loadPage(pg)"
        :class="[
          'px-3 py-1 rounded text-sm',
          pg === '…'
            ? 'cursor-default text-gray-400'
            : pg === currentPage
              ? 'bg-blue-600 text-white cursor-default'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700',
        ]"
      >
        {{ pg }}
      </button>
    </nav>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type { Comment } from "~~/api/contracts/shared";
import {
	type CommentSort,
	flagComment,
	getComments,
	likeComment,
	useComments,
} from "~~/api/public/comments";
import { deleteMyComment, updateMyComment } from "~~/api/reader/comments";
import { parseApiDate } from "~~/composables/apiDate";
import { highlightCode, loadHighlighter } from "~~/composables/useCodeHighlight";
import { commentMarkdownToHtml, loadPurify } from "~~/composables/useMarkdown";
import { paginationPages } from "~~/composables/usePagination";
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

// `error` from the useFetch wrapper: a thread whose INITIAL fetch failed must
// render an error + retry, never the fake "be the first to comment" empty
// state that a null data payload would otherwise fall through to (the
// refreshError banner only covers *subsequent* refreshList() calls).
const {
	data: commentData,
	pending,
	error: initialLoadError,
	refresh: retryInitialLoad,
} = await useComments(props.postId, 1, 20);

const comments = computed(() => commentData.value?.items || []);
const total = computed(() => commentData.value?.total || 0);
const totalPages = computed(() => commentData.value?.total_pages || 0);
const currentPage = ref(1);

// Deep-link landing (DEC-072): a reply notification opens /posts/<slug>#comment-<id>;
// once the list renders, scroll the anchor into view (comments carry scroll-mt
// so the sticky header doesn't cover the target). The anchor may live on a page
// past the first (only page 1 is loaded at mount): walk the pages until the
// comment appears, then highlight + scroll (deep-dive finding — a reply on page
// 2+ used to silently do nothing).
let deepLinkResolved = false;
/** Walk the comment pages (each 20 rows) looking for a deep-linked comment
 * that isn't on the initially-loaded page 1, then land on its page and scroll
 * to it. Stops at the thread's last page (authoritative total_pages comes from
 * the page-1 payload; later fetches refresh it) or when a page falls short of
 * a full page. */
function scrollToComment(targetId: string): void {
	document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
}
async function landOnDeepLink(targetId?: string): Promise<void> {
	if (deepLinkResolved) return;
	// Optional explicit target (a freshly-posted comment that needs locating on
	// a non-newest page, ISS-384); default keeps reading window.location.hash.
	const resolvedId = targetId ?? window.location.hash.slice(1);
	if (!resolvedId.startsWith("comment-")) return;
	const targetNum = Number.parseInt(resolvedId.slice("comment-".length), 10);
	if (Number.isNaN(targetNum)) return;
	const perPage = 20;
	const totalPagesKnown = commentData.value?.total_pages || 1;
	for (let page = 2; page <= totalPagesKnown; page++) {
		const pageRes = await getComments(props.postId, page, perPage, currentSort.value);
		if (!pageRes?.items) break;
		if (pageRes.items.some((c) => c.id === targetNum)) {
			// Load the found page into the rendered list (mirrors loadPage),
			// then scroll to the freshly-rendered anchor.
			currentPage.value = page;
			commentData.value = pageRes;
			await nextTick();
			scrollToComment(`comment-${targetNum}`);
			deepLinkResolved = true;
			return;
		}
		// The response carries the authoritative total; stop when past it.
		const realTotal = pageRes.total_pages || 0;
		if (page >= realTotal || pageRes.items.length < perPage) break;
	}
}

onMounted(async () => {
	if (typeof window === "undefined" || !window.location.hash.startsWith("#comment-")) return;
	// First try page 1 (already loaded); walk further pages only if absent.
	const el = document.getElementById(window.location.hash.slice(1));
	if (el) {
		scrollToComment(window.location.hash.slice(1));
		deepLinkResolved = true;
		return;
	}
	void landOnDeepLink();
});

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
		const updated = await likeComment(comment.id);
		// $fetch rejects on failure (handled below); a 200 returns the updated
		// comment with its new count.
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

// The edit box focuses itself on open so a keyboard user lands in the editor
// (Ctrl/⌘+Enter submits, Escape cancels — both on the textarea/wrapper above).
const editTextarea = ref<HTMLTextAreaElement | null>(null);

function startEdit(comment: Comment): void {
	editingId.value = comment.id;
	editContent.value = comment.content;
	actionError.value = null;
	// happy-dom (and teardown) may hand back a detached element without focus;
	// focus is a progressive nicety, never a requirements gate.
	nextTick(() => {
		if (typeof editTextarea.value?.focus === "function") editTextarea.value.focus();
	});
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
		const updated = await updateMyComment(comment.id, trimmed);
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

// --- Comment flag/report (DEC-108, TASK-166) ---
// A visitor flags an inappropriate comment for moderation; the backend dedups
// by (comment, source), and the browser keeps its own guard so one person
// reports a comment at most once (mirrors the like dedup).
const FLAG_PREFIX = "flagged-comments:";
function isCommentFlagged(id: number): boolean {
	if (typeof window === "undefined") return false;
	return localStorage.getItem(`${FLAG_PREFIX}${id}`) === "1";
}
function markCommentFlagged(id: number): void {
	if (typeof window === "undefined") return;
	localStorage.setItem(`${FLAG_PREFIX}${id}`, "1");
}

const flaggingIds = ref<Set<number>>(new Set());
const flagError = ref<string | null>(null);

async function handleCommentFlag(comment: Comment): Promise<void> {
	if (isCommentFlagged(comment.id) || flaggingIds.value.has(comment.id)) return;
	flaggingIds.value = new Set(flaggingIds.value).add(comment.id);
	flagError.value = null;
	try {
		// A resolved flag = server-confirmed (is_new distinguishes first-vs-dup
		// flag server-side but either way the local "flagged" state should stick).
		await flagComment(comment.id);
		markCommentFlagged(comment.id);
	} catch {
		flagError.value = t("components.commentList.flagError");
	} finally {
		const s = new Set(flaggingIds.value);
		s.delete(comment.id);
		flaggingIds.value = s;
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
// Whether the currently-open reply form holds an unsent draft (reported by
// CommentForm via update:dirty). Cancelling a reply or re-targeting another
// comment unmounts that form, silently discarding the unsent text if unguarded.
const replyDirty = ref(false);

// Ask before any reply-target transition that would unmount a form holding a
// draft. The old guard lived in CommentForm's parentId watch, but each reply
// form is a FRESH instance mounted inside `v-if="replyTo?.id === comment.id"`,
// so a target switch replaces the instance entirely — the watch never fired
// and the draft was lost before anyone could decline (deep-dive finding).
function confirmDiscardReplyDraft(): boolean {
	if (replyTo.value && replyDirty.value) {
		const subject = t("components.commentList.discardConfirm");
		if (typeof window !== "undefined" && !window.confirm(subject)) return false;
	}
	return true;
}

// Cancel via the reply form's own cancel button (CommentForm emits `cancel`).
function cancelReply(): void {
	if (!confirmDiscardReplyDraft()) return;
	replyTo.value = null;
	replyDirty.value = false;
}

function toggleReply(comment: Comment) {
	if (!confirmDiscardReplyDraft()) return;
	replyTo.value =
		replyTo.value?.id === comment.id ? null : { id: comment.id, nickname: comment.nickname };
	replyDirty.value = false; // a freshly-mounted target starts clean
}

const refreshing = ref(false);
// Sort/pagination refetch failures were silent (void refreshList() + unhandled
// rejections): an offline reader flipped the sort and saw nothing change (ISS-307).
const refreshError = ref<string | null>(null);
// Monotonic request sequence so a slow earlier response (page fetch) cannot
// overwrite a newer sort/filter response (same guard as comments.vue/mine,
// useReadingHistory ISS-128, HeaderSearch).
let refreshSeq = 0;

async function fetchPage(seq: number): Promise<void> {
	const data = await getComments(props.postId, currentPage.value, 20, currentSort.value);
	// The sequence is authoritative for the DATA too, not just the error banner:
	// a slow page-3 response landing after the reader already clicked to page 4
	// must not overwrite page 4 with page 3 (deep-dive finding — the old guard
	// only protected refreshError/refreshing, so the list could show page 3
	// while pagination highlighted page 4).
	if (seq !== refreshSeq) return;
	commentData.value = data;
	if (data.items.length === 0 && data.total > 0) {
		// The current page drained (e.g. the last comment of the LAST page was
		// just deleted) yet comments remain on earlier pages — clamp back to the
		// last valid page instead of showing a misleading "no comments yet".
		const last = Math.max(1, data.total_pages || 1);
		if (currentPage.value !== last) {
			currentPage.value = last;
			await fetchPage(seq); // bound: same intent, so keep its sequence slot
		}
	}
}

async function refreshList(): Promise<boolean> {
	const seq = ++refreshSeq; // invalidate any in-flight older request
	refreshing.value = true;
	refreshError.value = null;
	try {
		await fetchPage(seq);
	} catch {
		// Only the latest attempt owns the error banner (a stale in-flight
		// rejection from an older sort/page must not blame the current state).
		if (seq === refreshSeq) refreshError.value = t("components.commentList.refreshError");
		return false;
	} finally {
		if (seq === refreshSeq) refreshing.value = false;
	}
	return true;
}

function retryRefresh(): void {
	if (refreshing.value) return;
	void refreshList();
}

async function handleReplied(created: Comment | undefined) {
	// A just-posted comment has the newest timestamp, so under the default
	// newest sort it lands on page 1 — for a reader replying from page 2+, the
	// old code refreshed the CURRENT page and their reply was nowhere on screen
	// (no toast, no jump), reading as a silent failure and inviting a double
	// post (ISS-384). Jump to the page that holds the new row and scroll to it.
	const newId = created?.id;
	const hasParentPresence = created?.parent_id != null && byId.value.has(created.parent_id);
	const jumpToPage = currentSort.value !== "oldest" ? 1 : commentData.value?.total_pages || 1;
	// A reply nests under its parent (same page at most times); a top-level
	// comment on non-oldest sorts always sorts to page 1. See the sort's final
	// page for oldest, then locate the row precisely.
	if (newId) {
		currentPage.value = jumpToPage;
	}
	// Only collapse the reply form when the list actually refreshed: the reply
	// POST already succeeded, but closing the form anyway would drop its
	// "posted" feedback while the list still lacks the new comment — a reader
	// could re-submit and double-post (deep-dive finding). On refresh failure
	// keep the form open (success message visible, refreshError banner offers
	// retry) so the outcome is unambiguous.
	if (await refreshList()) {
		replyTo.value = null;
		replyDirty.value = false;
	}
	// Scroll the freshly-created row into view once it's rendered (the reply
	// form's own "posted" success may be below the fold). Bounded to the
	// comment's OWN page context: if the server nested it elsewhere (e.g. under
	// a parent pulled onto the page), land on the anchor that actually exists.
	if (newId) {
		await nextTick();
		const anchor = document.getElementById(`comment-${newId}`);
		if (anchor) {
			anchor.scrollIntoView({ behavior: "smooth", block: "start" });
		} else if (!hasParentPresence) {
			// The new row didn't render where we jumped (edge: an exotic sort or
			// moderation re-order) — walk pages like the deep-link path does.
			void landOnDeepLink(`comment-${newId}`);
		}
	}
}

// Windowed, ellipsis-aware page tokens (first / current-window / last joined
// by "…"), matching the shared archive/search/category/tag/my-comments feeds —
// the previous hand-rolled 5-window had no far-page affordance, so a deep
// thread offered no way to jump to the first/last page without walking the
// window (survey finding, ISS-370).
const paginationTokens = computed(() => paginationPages(totalPages.value, currentPage.value));

async function loadPage(page: number | "…") {
	if (typeof page !== "number" || page === currentPage.value) return;
	currentPage.value = page;
	await refreshList();
}

function formatDate(dateStr: string): string {
	// Naive-UTC wire values parse as UTC (parseApiDate appends "Z"); the raw
	// `new Date(dateStr)` form treated them as local wall-clock and showed the
	// wrong day to readers east/west of UTC (deep-dive finding).
	return (
		parseApiDate(dateStr)?.toLocaleDateString(locale.value === "zh" ? "zh-CN" : "en-US", {
			year: "numeric",
			month: "short",
			day: "numeric",
		}) ?? ""
	);
}

// Expose the imperative refetch so a sibling comment form (post page) can
// refresh the list/count after a successful top-level submission (ISS-126).
defineExpose({ refreshList });
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
