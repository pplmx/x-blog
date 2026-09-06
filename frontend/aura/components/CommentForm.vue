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
        <label for="comment-hp">Website</label>
        <input id="comment-hp" v-model="form.website" type="text" tabindex="-1" autocomplete="off" />
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
            for="comment-nickname"
            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
          >{{ t('components.commentForm.nickname') }}</label>
          <input
            id="comment-nickname"
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
            for="comment-email"
            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
          >{{ t('components.commentForm.email') }}</label>
          <input
            id="comment-email"
            v-model="form.email"
            type="email"
            required
            autocomplete="email"
            :placeholder="t('components.commentForm.email')"
            class="px-3 py-2 w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          >
        </div>
      </div>

      <div>
        <label
          for="comment-content"
          class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
        >{{ t('components.commentForm.content') }}</label>
        <textarea
          id="comment-content"
          ref="contentRef"
          v-model="form.content"
          required
          rows="4"
          :placeholder="t('components.commentForm.content')"
          class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-y"
          @keydown.exact.esc.prevent="emit('cancel')"
          @keydown.ctrl.enter.prevent="submitWithShortcut()"
          @keydown.meta.enter.prevent="submitWithShortcut()"
        />
        <!-- Markdown hint (DEC-088): comments render as sanitized Markdown. -->
        <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
          <Icon icon="lucide:braces" class="w-3 h-3 inline mr-0.5" />
          {{ t('components.commentForm.markdownHint') }}
        </p>
      </div>

      <button
        type="submit"
        :disabled="submitting"
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
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type { Comment } from "~~/api/contracts/shared";
import { createComment } from "~~/api/public/comments";
import { useReaderAuth } from "~~/composables/useReaderAuth";

interface Props {
	postId: number;
	parentId?: number | null;
	replyingTo?: string | null;
	submitLabel?: string | null;
	/** Focus the textarea on mount (reply/edit call sites). */
	autofocus?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
	parentId: undefined,
	replyingTo: undefined,
	submitLabel: undefined,
	autofocus: false,
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
	if (submitting.value) return;
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
});

const submitting = ref(false);
const error = ref("");
const success = ref("");

// Dirty = the reader has typed something unsent. Used to guard reply-target
// switches so an in-progress draft is never silently discarded. The parent
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
	if (submitting.value) return;
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
		});
		success.value = t("components.commentForm.submitSuccess");
		form.value = { nickname: "", email: "", content: "", website: "" };
		emit("update:dirty", false);
		emit("submitted", created);
	} catch (e: any) {
		error.value = e?.message || t("components.commentForm.submitFailed");
	} finally {
		submitting.value = false;
	}
}
</script>
