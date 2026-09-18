<!--
  Guest comment management (round 385, DEC-435/TASK-444).

  Landed on via the `?token=` link inside the approval email a consenting
  anonymous commenter receives when their comment goes live. The token is the
  per-comment secret only that email carries (DEC-332), so holding it proves
  the comment is theirs — the same ownership argument as the reply-email
  unsubscribe page. Lets the guest edit their comment text (the edit re-enters
  moderation, exactly like a signed-in reader's edit) or delete it entirely,
  without any account.

  Route lives at /comment-manage (flat, NOT under /comments/): a child under
  the existing /comments page nests under it, and without a <NuxtPage> in that
  parent the child route never mounts (Nuxt page-nesting gotcha, per the
  DEC-332 /comment-reply-unsubscribe precedent).
-->
<script setup lang="ts">
import { ref } from "vue";

const { t } = useLang();

useSeo(() => ({
	title: t("reader.commentManage.seoTitle"),
	description: t("reader.commentManage.seoDesc"),
	path: "/comment-manage",
}));

const route = useRoute();
const token = computed(() => {
	const v = route.query.token;
	return typeof v === "string" && v ? v : "";
});

// loading | invalid | ready | deleted | error
const state = ref<"loading" | "invalid" | "ready" | "deleted" | "error">("loading");
const comment = ref<{
	id: number;
	content: string;
	is_approved: boolean | null;
	post_id: number;
} | null>(null);
const post = ref<{ id: number; title: string; slug: string } | null>(null);
const draft = ref("");
const saving = ref(false);
const deleting = ref(false);
const savedFlash = ref(false);
const errorMsg = ref(false);

// Fire once when the page mounts with a token; a missing token or an unknown
// one (backend 404) both land on the invalid state, indistinguishable to the
// visitor so tokens are not enumerable.
let fired = false;
async function load() {
	if (fired) return;
	fired = true;
	if (!token.value) {
		state.value = "invalid";
		return;
	}
	try {
		const { getGuestCommentManage } = await import("~~/api/public/comments");
		const data = await getGuestCommentManage(token.value);
		comment.value = data.comment;
		post.value = data.post;
		draft.value = data.comment.content;
		state.value = "ready";
	} catch (e) {
		const status =
			(e as { response?: { status?: number } } | undefined)?.response?.status ??
			(e as { status?: number } | undefined)?.status;
		state.value = status === 404 ? "invalid" : "error";
		errorMsg.value = status !== 404;
	}
}

async function save() {
	if (saving.value || deleting.value || !comment.value) return;
	const trimmed = draft.value.trim();
	if (!trimmed) return;
	saving.value = true;
	errorMsg.value = false;
	try {
		const { editGuestCommentManage } = await import("~~/api/public/comments");
		const updated = await editGuestCommentManage(token.value, trimmed);
		comment.value = updated;
		draft.value = updated.content;
		savedFlash.value = true;
		window.setTimeout(() => {
			savedFlash.value = false;
		}, 2500);
	} catch {
		errorMsg.value = true;
	} finally {
		saving.value = false;
	}
}

async function remove() {
	if (deleting.value || saving.value || !comment.value) return;
	if (!window.confirm(t("reader.commentManage.deleteConfirm"))) return;
	deleting.value = true;
	errorMsg.value = false;
	try {
		const { deleteGuestCommentManage } = await import("~~/api/public/comments");
		await deleteGuestCommentManage(token.value);
		state.value = "deleted";
	} catch {
		errorMsg.value = true;
	} finally {
		deleting.value = false;
	}
}

const statusKey = computed(() => {
	if (!comment.value) return "statusUnknown";
	if (comment.value.is_approved === true) return "statusApproved";
	if (comment.value.is_approved === false) return "statusPending";
	return "statusUnknown";
});

onMounted(() => void load());
</script>

<template>
  <div class="max-w-xl mx-auto px-4 py-12">
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 p-8">
      <div class="mb-6">
        <div
          class="w-12 h-12 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 flex items-center justify-center mb-4"
        >
          <Icon icon="lucide:message-square" class="w-6 h-6 text-white" />
        </div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {{ t("reader.commentManage.title") }}
        </h1>
      </div>

      <div v-if="state === 'loading'" role="status" class="text-center py-6">
        <Icon icon="lucide:loader-2" class="w-6 h-6 animate-spin text-blue-500 mx-auto" />
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-3">
          {{ t("reader.commentManage.loading") }}
        </p>
      </div>

      <div v-else-if="state === 'invalid'" role="status" class="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
        <p class="text-sm text-amber-700 dark:text-amber-300">
          {{ t("reader.commentManage.invalid") }}
        </p>
      </div>

      <div v-else-if="state === 'deleted'" role="status" class="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
        <p class="text-sm text-green-700 dark:text-green-300">
          {{ t("reader.commentManage.deleted") }}
        </p>
      </div>

      <div v-else-if="state === 'error'" role="status" class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
        <p class="text-sm text-red-600 dark:text-red-400">
          {{ t("reader.commentManage.errors.network") }}
        </p>
      </div>

      <div v-else-if="state === 'ready' && comment" class="space-y-5">
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <span v-if="post" class="text-gray-500 dark:text-gray-400">
            {{ t("reader.commentManage.onPost") }}
            <NuxtLink :to="`/posts/${post.slug}`" class="text-blue-600 dark:text-blue-400 hover:underline">
              {{ post.title }}
            </NuxtLink>
          </span>
          <span
            class="px-2 py-0.5 rounded-full text-xs font-medium"
            :class="{
              'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300': statusKey === 'statusApproved',
              'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300': statusKey === 'statusPending',
              'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300': statusKey === 'statusUnknown',
            }"
          >
            {{ t(`reader.commentManage.${statusKey}`) }}
          </span>
        </div>

        <div>
          <label for="comment-manage-text" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {{ t("reader.commentManage.editLabel") }}
          </label>
          <textarea
            id="comment-manage-text"
            v-model="draft"
            rows="5"
            class="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
            :disabled="deleting"
          />
        </div>

        <div v-if="errorMsg" class="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p class="text-sm text-red-600 dark:text-red-400">
            {{ t("reader.commentManage.errors.network") }}
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            :disabled="saving || deleting || !draft.trim()"
            @click="save"
          >
            <Icon v-if="saving" icon="lucide:loader-2" class="w-4 h-4 animate-spin" />
            <span>{{ saving ? t("reader.commentManage.saving") : t("reader.commentManage.save") }}</span>
          </button>
          <span v-if="savedFlash" class="text-sm text-green-600 dark:text-green-400">
            {{ t("reader.commentManage.saved") }}
          </span>
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors ml-auto"
            :disabled="saving || deleting"
            @click="remove"
          >
            <Icon v-if="deleting" icon="lucide:loader-2" class="w-4 h-4 animate-spin" />
            <span>{{ deleting ? t("reader.commentManage.deleting") : t("reader.commentManage.delete") }}</span>
          </button>
        </div>

        <div v-if="post" class="pt-3 border-t border-gray-100 dark:border-gray-700">
          <NuxtLink
            :to="`/posts/${post.slug}#comment-${comment.id}`"
            class="text-sm text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
          >
            <Icon icon="lucide:arrow-left" class="w-3.5 h-3.5" />
            {{ t("reader.commentManage.backToThread") }}
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>
