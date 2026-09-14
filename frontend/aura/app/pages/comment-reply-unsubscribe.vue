<!--
  Guest reply-email unsubscribe (DEC-332, TASK-392).

  Landed on via the `?token=` link inside a guest reply-email (the per-comment
  token only that email carries). Fires the backend unsubscribe once on the
  token, then shows a clear success/invalid state. No form: the token IS the
  action — clicking the emailed link is the consent revocation, so we do not
  ask for confirmation or credentials (there is no account to log into).

  Route lives at /comment-reply-unsubscribe (flat, NOT under /comments/): a
  child under the existing /comments page nests under it, and without a
  <NuxtPage> in that parent the child route never mounts (Nuxt page-nesting
  gotcha, per the same-dir [id] pattern).
-->
<script setup lang="ts">
import { ref } from "vue";

const { t } = useLang();

useSeo(() => ({
	title: t("reader.replyUnsubscribe.seoTitle"),
	description: t("reader.replyUnsubscribe.seoDesc"),
	path: "/comment-reply-unsubscribe",
}));

const route = useRoute();
const token = computed(() => {
	const v = route.query.token;
	return typeof v === "string" && v ? v : "";
});

const state = ref<"pending" | "done" | "invalid" | "error">("pending");

// Fire once when the page mounts with a token. Guarded by an in-flight flag so
// a duplicate onMounted/route change can't POST twice.
let fired = false;
async function run() {
	if (fired) return;
	if (!token.value) {
		state.value = "invalid";
		return;
	}
	fired = true;
	try {
		const { unsubscribeGuestReplyNotify } = await import("~~/api/public/comments");
		await unsubscribeGuestReplyNotify(token.value);
		state.value = "done";
	} catch (e) {
		// A 404 = unknown/spent token (the only business-level answer the
		// endpoint gives; it is also what a random guess gets). Anything else
		// (no response: unreachable backend) is a NETWORK condition — the token
		// may still be valid, and re-clicking the emailed link will eventually
		// work, so we must not tell the holder their link is spent.
		const status =
			(e as { response?: { status?: number } } | undefined)?.response?.status ??
			(e as { status?: number } | undefined)?.status;
		state.value = status === 404 ? "invalid" : "error";
	}
}
onMounted(() => void run());
</script>

<template>
  <div class="max-w-md mx-auto px-4 py-12">
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 p-8">
      <div class="text-center mb-6">
        <div
          class="w-16 h-16 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 flex items-center justify-center mx-auto mb-4"
        >
          <Icon icon="lucide:mail-x" class="w-8 h-8 text-white" />
        </div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {{ t("reader.replyUnsubscribe.title") }}
        </h1>
      </div>

      <div v-if="state === 'pending'" role="status" class="text-center">
        <Icon icon="lucide:loader-2" class="w-6 h-6 animate-spin text-blue-500 mx-auto" />
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-3">
          {{ t("reader.replyUnsubscribe.processing") }}
        </p>
      </div>

      <div
        v-else-if="state === 'done'"
        role="status"
        class="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg"
      >
        <p class="text-sm text-green-700 dark:text-green-300">
          {{ t("reader.replyUnsubscribe.success") }}
        </p>
      </div>

      <div
        v-else-if="state === 'error'"
        role="status"
        class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg"
      >
        <p class="text-sm text-red-600 dark:text-red-400">
          {{ t("reader.replyUnsubscribe.errors.network") }}
        </p>
      </div>

      <div
        v-else
        role="status"
        class="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg"
      >
        <p class="text-sm text-amber-700 dark:text-amber-300">
          {{ t("reader.replyUnsubscribe.invalid") }}
        </p>
      </div>
    </div>
  </div>
</template>
