<template>
  <section>
    <h2 class="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">{{ submitLabel || t('components.commentForm.title') }}</h2>

    <!-- Reply context (keydown.esc bubbles from the panel below to cancel
         without reaching for the Cancel button) -->
    <div
      v-if="replyingTo"
      @keydown.esc.prevent="emit('cancel')"
      class="flex items-center justify-between gap-2 mb-4 px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/40"
    >
      <p class="text-sm text-blue-700 dark:text-blue-300">
        {{ t('components.commentForm.replyingTo', { name: replyingTo }) }}
      </p>
      <button
        type="button"
        class="text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-200 transition-colors"
        @click="emit('cancel')"
      >
        {{ t('components.commentForm.cancelReply') }}
      </button>
    </div>

    <form @submit.prevent="handleSubmit" class="space-y-4">
      <!-- Anti-spam honeypot: visually hidden, screens off for AT/human users.
           A bot filling every field lands here and the backend rejects it. -->
      <div class="absolute left-[-9999px] top-auto h-1 w-1 overflow-hidden" aria-hidden="true">
        <label :for="fieldId('comment-hp')">Website</label>
        <input :id="fieldId('comment-hp')" v-model="form.website" type="text" tabindex="-1" autocomplete="off" />
      </div>

      <!-- Signed-in reader: identity comes from the account, no name/email
           inputs (the backend stamps the verified display_name). -->
      <div
        v-if="signedIn"
        id="reader-comment-identity"
        class="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/40 rounded-lg text-sm text-gray-700 dark:text-gray-300"
      >
        <Icon icon="lucide:badge-check" class="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
        <span>{{ t('components.commentForm.asReader', { name: identityLabel }) }}</span>
      </div>

      <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label
            :for="fieldId('comment-nickname')"
            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
          >{{ t('components.commentForm.nickname') }}</label>
          <input
            :id="fieldId('comment-nickname')"
            v-model="form.nickname"
            type="text"
            required
            autocomplete="nickname"
            :placeholder="t('components.commentForm.nickname')"
            class="px-3 py-2 w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          >
        </div>
        <div>
          <label
            :for="fieldId('comment-email')"
            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
          >{{ t('components.commentForm.email') }}</label>
          <input
            :id="fieldId('comment-email')"
            v-model="form.email"
            type="email"
            required
            autocomplete="email"
            :placeholder="t('components.commentForm.email')"
            class="px-3 py-2 w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          >
        </div>
        <!-- Guest reply-email consent (DEC-332/TASK-392): an anonymous
             commenter's email is otherwise collected and stored but never used;
             this checkbox opts them into a best-effort email when a reply to
             their comment is approved. Signed-in readers get reply email from
             their account-level preference (DEC-197), so the control only
             renders in the guest form (this grid is the v-else of signedIn). -->
        <div class="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400 sm:col-span-2">
          <input
            :id="fieldId('comment-reply-notify')"
            v-model="form.replyNotifyEmail"
            type="checkbox"
            class="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-500 focus:ring-blue-500"
          >
          <label
            :for="fieldId('comment-reply-notify')"
            class="font-normal"
          >{{ t('components.commentForm.replyNotify') }}</label>
        </div>
      </div>

      <div>
        <label
          :for="fieldId('comment-content')"
          class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
        >{{ t('components.commentForm.content') }}</label>
        <!-- Write/Preview toggle (DEC-306/TASK-381): the comment form advertises
             sanitized-Markdown rendering (DEC-088) and comments wait in the
             moderation queue (DEC-066), so a commenter must see their draft
             render BEFORE submitting — a malformed markup draft would otherwise
             burn an approval cycle with no feedback. Both tabs reuse the exact
             pipeline the comment list ships (commentMarkdownToHtml + lazy
             highlight.js), so "what you see here" IS "what gets posted". -->
        <div
          role="tablist"
          aria-label="Comment markdown preview"
          class="flex items-center border-b border-gray-200 dark:border-gray-700 mb-2"
        >
          <button
            type="button"
            role="tab"
            data-tab="write"
            :aria-selected="!previewing"
            :tabindex="previewing ? -1 : 0"
            class="px-3 py-1.5 text-sm transition-colors border-b-2 -mb-px"
            :class="
              !previewing
                ? 'border-blue-500 text-blue-600 dark:text-blue-400 font-medium'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            "
            @click="previewing = false"
          >{{ t('components.commentForm.write') }}</button>
          <button
            type="button"
            role="tab"
            data-tab="preview"
            :aria-selected="previewing"
            :tabindex="previewing ? 0 : -1"
            class="px-3 py-1.5 text-sm transition-colors border-b-2 -mb-px"
            :class="
              previewing
                ? 'border-blue-500 text-blue-600 dark:text-blue-400 font-medium'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            "
            @click="previewing = true"
          >{{ t('components.commentForm.preview') }}</button>
        </div>

        <!-- Write tab: the live editor ctrl/⌘+Enter submits (keyboard parity).
             The wrapper is `relative` so the '@'-mention picker (DEC-324) can
             drop below the textarea's full width. -->
        <div v-if="!previewing" class="relative">
          <textarea
            :id="fieldId('comment-content')"
            ref="contentRef"
            v-model="form.content"
            required
            rows="4"
            :disabled="submitting || disabled"
            :placeholder="t('components.commentForm.content')"
            role="combobox"
            aria-autocomplete="list"
            :aria-expanded="mentionOpen ? 'true' : 'false'"
            :aria-controls="mentionOpen ? fieldId('mention-list') : undefined"
            :aria-activedescendant="
              mentionOpen && mentionSuggestions[mentionIndex]
                ? mentionOptionId(mentionIndex)
                : undefined
            "
            class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-y disabled:opacity-60 disabled:cursor-not-allowed"
            @input="onContentInput"
            @keydown="onTextareaKeydown"
            @keydown.exact.esc.prevent="onEscape()"
            @keydown.ctrl.enter.prevent="submitWithShortcut()"
            @keydown.meta.enter.prevent="submitWithShortcut()"
          />
          <div
            v-if="mentionOpen"
            :id="fieldId('mention-list')"
            role="listbox"
            data-testid="mention-list"
            class="absolute z-20 left-0 right-0 top-full mt-1 max-h-56 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1"
          >
            <button
              v-for="(s, i) in mentionSuggestions"
              :key="s.id"
              :id="mentionOptionId(i)"
              type="button"
              role="option"
              :aria-selected="i === mentionIndex"
              data-testid="mention-option"
              :class="[
                'w-full text-left flex items-center gap-2 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 hover:bg-amber-50 dark:hover:bg-amber-950/40',
                { 'bg-amber-50 dark:bg-amber-950/40': i === mentionIndex },
              ]"
              @mousedown.prevent="insertMention(i)"
            >
              <span
                aria-hidden="true"
                class="flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 text-xs font-semibold shrink-0 overflow-hidden"
              >
                <img
                  v-if="s.avatar_url"
                  :src="s.avatar_url"
                  alt=""
                  class="w-full h-full object-cover"
                />
                <template v-else>{{ (s.display_name[0] ?? '?').toUpperCase() }}</template>
              </span>
              <span data-testid="mention-name" class="min-w-0 truncate">{{ s.display_name }}</span>
            </button>
          </div>
        </div>

        <!-- Preview tab (role="tabpanel"): the same commentMarkdownToHtml the
             list uses, so a draft renders byte-for-byte as the shipped comment
             would. Empty drafts show a hint instead of a blank box. -->
        <div
          v-if="previewing"
          :id="fieldId('comment-preview')"
          role="tabpanel"
          ref="previewEl"
          class="comment-body comment-preview min-h-16 px-3 py-2 border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 rounded-lg text-sm text-gray-700 dark:text-gray-300"
        >
          <p v-if="!form.content.trim()" class="text-gray-400 dark:text-gray-500">
            {{ t('components.commentForm.previewEmpty') }}
          </p>
          <div v-else v-html="previewHtml"></div>
        </div>

        <!-- Markdown hint (DEC-088): comments render as sanitized Markdown. -->
        <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
          <Icon icon="lucide:braces" class="w-3 h-3 inline mr-0.5" />
          {{ t('components.commentForm.markdownHint') }}
        </p>
      </div>

      <button
        type="submit"
        :disabled="submitting || disabled"
        class="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
      >
        <Icon
          v-if="submitting"
          icon="lucide:loader-2"
          class="w-4 h-4 animate-spin"
        />
        {{ submitting ? t('components.commentForm.submitting') : t('components.commentForm.submit') }}
      </button>

      <p v-if="error" role="alert" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
      <p v-if="success" role="status" class="text-sm text-green-600 dark:text-green-400">{{ t('components.commentForm.submitSuccess') }}</p>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, watch } from "vue";
import type { Comment } from "~~/api/contracts/shared";
import { createComment } from "~~/api/public/comments";
import { type ReaderMentionSuggestion, suggestMentionReaders } from "~~/api/public/readers";
import { highlightCode, loadHighlighter } from "~~/composables/useCodeHighlight";
import { commentMarkdownToHtml } from "~~/composables/useMarkdown";
import { useReaderAuth } from "~~/composables/useReaderAuth";

// A post page mounts TWO CommentForms at once — the standalone bottom-of-page
// form and (while open) an inline reply form — so the DOM ids must be unique
// per instance: duplicate `comment-content` etc. made `label for` resolve to
// the FIRST element in document order (clicking one form's label focused the
// other's textarea) and broke WCAG 4.1.1 (round 278). useId() is captured ONCE
// per instance (it returns a fresh id on every call) and is SSR-hydration
// stable, so label `for` and input `id` always agree.
const instanceId = useId();
const fieldId = (name: string) => `${name}-${instanceId}`;

interface Props {
	postId: number;
	parentId?: number | null;
	replyingTo?: string | null;
	submitLabel?: string | null;
	/** Focus the textarea on mount (reply/edit call sites). */
	autofocus?: boolean;
	/** Disabled while the surrounding page is mid-SPA-refetch: submitting during
	 * the prev/next window would attach the comment to the OLD post the reader
	 * is still looking at. (ISS-416, article-page deep-dive) */
	disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
	parentId: undefined,
	replyingTo: undefined,
	submitLabel: undefined,
	autofocus: false,
	disabled: false,
});

const contentRef = ref<HTMLTextAreaElement | null>(null);

// `submitted` carries the freshly-created comment so the parent can navigate
// to it (a reply on comment page 2+ sorted to page 1 under newest and vanished
// off-screen — the parent needs the id to jump to the row, ISS-384).
const emit = defineEmits<{
	submitted: [comment: Comment];
	cancel: [];
	"update:dirty": [value: boolean];
}>();

const { t } = useLang();
const { isAuthenticated, reader } = useReaderAuth();

// A signed-in reader comments under their account identity — no nickname/email
// inputs, the createComment call includes the reader JWT and the backend stamps
// the verified display_name (client-provided name is ignored). (DEC-062,
// TASK-136)
//
// The reader identity is only known post-hydration (localStorage is
// client-only): render the anonymous form during SSR + the first client render
// (hydrationStats agree), then flip to the identity form after mount. Without
// this gate Vue's hydration mismatch on the v-if region leaves the form
// half-patched (RIL reader-comments e2e).
const hydrated = ref(false);
onMounted(() => {
	hydrated.value = true;
	// Reply/edit call sites pass autofocus so a keyboard user lands straight in
	// the editor instead of Tabbing through the rest of the thread (a11y).
	if (props.autofocus) {
		nextTick(() => contentRef.value?.focus());
	}
});

/** Ctrl/⌘+Enter submits the form without a mouse click (keyboard parity). */
function submitWithShortcut(): void {
	if (submitting.value || props.disabled) return;
	void handleSubmit();
}
const signedIn = computed(() => hydrated.value && isAuthenticated.value && !!reader.value);
const identityLabel = computed(() => reader.value?.display_name || reader.value?.email || "");

const form = ref({
	// Placeholders the backend ignores for signed-in readers; the form only
	// submits them for anonymous commenters.
	nickname: "",
	email: "",
	content: "",
	website: "", // anti-spam honeypot — hidden, humans never fill it
	// Guest reply-email consent (DEC-332/TASK-392): default off — the backend
	// only emails an anonymous commenter who explicitly opted in.
	replyNotifyEmail: false,
});

const submitting = ref(false);
const error = ref("");
const success = ref("");

// --- Markdown live preview (DEC-306/TASK-381) ---
// The Write/Preview toggle owns a `previewing` flag; the preview pane reuses
// commentMarkdownToHtml — the exact renderer the comment list ships — so the
// draft renders byte-for-byte as the posted comment will. `previewHtml` is
// recomputed on every keystroke (cheap: one marked pass over a comment-sized
// body), keeping the two tabs in lock-step.
const previewing = ref(false);
const previewEl = ref<HTMLElement | null>(null);
const previewHtml = computed(() => commentMarkdownToHtml(form.value.content));

// Lazy syntax highlighting for fenced code in the preview (same loadHighlighter
// + highlightCode path as CommentList DEC-090/TASK-157): once the preview pane
// becomes visible (or the draft changes under it), tokenize any .comment-body
// pre code blocks it holds. highlightCode escapes its source, so installing the
// highlighted HTML never weakens the v-html XSS guarantees (TASK-156).
watch([previewing, () => form.value.content], async () => {
	if (!previewing.value || !previewEl.value) return;
	await nextTick();
	const h = await loadHighlighter();
	const blocks = previewEl.value.querySelectorAll<HTMLElement>(".comment-body pre code");
	for (const el of blocks) {
		const lang = (el.className.match(/language-([\w-]+)/)?.[1] ?? "").trim();
		el.innerHTML = highlightCode(h, lang, el.textContent ?? "");
	}
});

// --- '@'-mention picker (DEC-324, TASK-390) ---
// Typing "@" in the editor opens a suggestion list of active readers whose
// display name matches what follows the "@" (word left of the caret); picking
// one inserts "@<display name> " at the caret so the submitted comment's
// word-boundary match (DEC-322) resolves. State is derived from the caret
// position, not a regex over the whole draft, so "@" in prose that isn't being
// typed at (e.g. mid-word) never opens the picker.
const mentionOpen = ref(false);
const mentionQuery = ref("");
const mentionIndex = ref(0);
const mentionSuggestions = ref<ReaderMentionSuggestion[]>([]);
const mentionToken = ref<{ start: number; end: number } | null>(null);
let mentionTimer: ReturnType<typeof setTimeout> | undefined;

function mentionOptionId(index: number): string {
	return `${fieldId("mention-option")}-${index}`;
}

function closeMentions(): void {
	mentionOpen.value = false;
	mentionSuggestions.value = [];
	mentionToken.value = null;
	if (mentionTimer) {
		clearTimeout(mentionTimer);
		mentionTimer = undefined;
	}
}
onUnmounted(closeMentions);

/** Recompute the "@" token immediately left of the caret, if any. */
function updateMentionToken(): void {
	const el = contentRef.value;
	if (!el) {
		mentionToken.value = null;
		return;
	}
	const caret = el.selectionStart ?? form.value.content.length;
	const before = form.value.content.slice(0, caret);
	const ws = Math.max(before.lastIndexOf(" "), before.lastIndexOf("\n"), before.lastIndexOf("\t"));
	const segment = before.slice(ws + 1);
	// The token is "@" + the (possibly empty) query, with no other "@" or
	// whitespace inside it — so "@riki," does not open the picker.
	const m = /^@([^\s@]*)$/.exec(segment);
	mentionToken.value = m ? { start: ws + 1, end: caret } : null;
}

async function fetchMentionSuggestions(): Promise<void> {
	const token = mentionToken.value;
	if (!token) return;
	try {
		const items = await suggestMentionReaders(mentionQuery.value);
		// Only apply if the user is still mid-token (the draft may have
		// changed while the request was in flight).
		if (!mentionToken.value) return;
		mentionSuggestions.value = items;
		mentionIndex.value = 0;
		mentionOpen.value = items.length > 0;
	} catch {
		// Best effort: a failed suggestion fetch just leaves the picker closed.
		if (mentionToken.value) {
			mentionSuggestions.value = [];
			mentionOpen.value = false;
		}
	}
}

function scheduleMentionFetch(): void {
	if (!mentionToken.value) return;
	if (mentionTimer) clearTimeout(mentionTimer);
	mentionTimer = setTimeout(() => void fetchMentionSuggestions(), 160);
}

/** Textarea input: keep the "@" token + suggestion query in sync. */
function onContentInput(): void {
	const el = contentRef.value;
	updateMentionToken();
	if (!mentionToken.value) {
		closeMentions();
		return;
	}
	mentionQuery.value = form.value.content.slice(
		mentionToken.value.start + 1,
		el?.selectionStart ?? form.value.content.length,
	);
	scheduleMentionFetch();
}

function moveMention(delta: number): void {
	const n = mentionSuggestions.value.length;
	if (!n) return;
	mentionIndex.value = (mentionIndex.value + delta + n) % n;
}

function insertMention(index: number): void {
	const picked = mentionSuggestions.value[index];
	const token = mentionToken.value;
	const el = contentRef.value;
	if (!picked || !token || !el) {
		closeMentions();
		return;
	}
	const value = form.value.content;
	form.value.content =
		value.slice(0, token.start) +
		`@${picked.display_name} ` +
		value.slice(Math.min(token.end, value.length));
	closeMentions();
	nextTick(() => {
		// Put the caret just after the inserted "@Name " so the reader can
		// keep typing without a second focus hop.
		const caret = token.start + picked.display_name.length + 2;
		el.focus();
		el.setSelectionRange(caret, caret);
	});
}

/** Keyboard handling on the textarea while the picker is open. */
function onTextareaKeydown(e: KeyboardEvent): void {
	if (!mentionOpen.value || !mentionSuggestions.value.length) return;
	// Leave modifier combos alone: Ctrl/⌘+Enter submits, Shift+Enter newlines
	// — only bare arrows / Enter / Tab steer the picker.
	if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
	if (e.key === "ArrowDown") {
		e.preventDefault();
		moveMention(1);
	} else if (e.key === "ArrowUp") {
		e.preventDefault();
		moveMention(-1);
	} else if (e.key === "Enter") {
		// With the picker open Enter selects (it must not submit or newline).
		e.preventDefault();
		insertMention(mentionIndex.value);
	}
}

/** Escape: close the picker first; only then cancel the whole form. */
function onEscape(): void {
	if (mentionOpen.value) closeMentions();
	else emit("cancel");
}

// (CommentList) owns the reply target transition and asks for confirmation;
// this component only REPORTS dirtiness via `update:dirty` — it can't revert
// a parentId prop change once made, so an inline confirm here would leave the
// draft attached to the NEW target (deep-dive finding: comment form now emits
// dirty state instead).
const dirty = computed(
	() =>
		Boolean(form.value.content.trim()) ||
		Boolean(form.value.nickname.trim()) ||
		Boolean(form.value.email.trim()),
);
watch(dirty, (isDirty) => emit("update:dirty", isDirty));
// Report the baseline on mount too — a form that mounts with content (e.g. a
// future same-instance reply switch) must not be mistaken for a clean one.
onMounted(() => emit("update:dirty", dirty.value));

async function handleSubmit() {
	// Re-entry guard: `submitting` only disables the submit BUTTON, but the
	// form's native submit also fires on Enter inside the nickname/email inputs
	// (and a fast double-click can beat Vue patching `disabled` in the same
	// frame) — without this, two quick submits POST two comments.
	if (submitting.value || props.disabled) return;
	// Signed-in readers only need content; anonymous must give nickname+email.
	if (!form.value.content) return;
	if (!signedIn.value && !(form.value.nickname && form.value.email)) return;

	submitting.value = true;
	error.value = "";
	success.value = "";

	try {
		const created = await createComment(props.postId, {
			// For signed-in readers the backend ignores nickname/email and stamps
			// the account identity; the empty email still satisfies the schema.
			nickname: signedIn.value ? identityLabel.value : form.value.nickname,
			email: signedIn.value ? "" : form.value.email,
			content: form.value.content,
			parent_id: props.parentId ?? null,
			website: form.value.website,
			// Consent is only meaningful for anonymous commenters; the backend
			// discards it for signed-in readers (their reply email comes from
			// the account-level DEC-197 preference).
			reply_notify_email: signedIn.value ? false : form.value.replyNotifyEmail,
		});
		success.value = t("components.commentForm.submitSuccess");
		form.value = { nickname: "", email: "", content: "", website: "", replyNotifyEmail: false };
		// Back to a clean Write tab: the emptied draft renders an empty-state
		// hint in preview, but a cleared editor is the clearer next action.
		previewing.value = false;
		emit("update:dirty", false);
		emit("submitted", created);
	} catch (e: any) {
		error.value = e?.message || t("components.commentForm.submitFailed");
	} finally {
		submitting.value = false;
	}
}
</script>
