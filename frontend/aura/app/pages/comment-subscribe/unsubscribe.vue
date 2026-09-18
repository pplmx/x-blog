<!--
  Guest thread-follow unsubscribe (DEC-427, TASK-438).

  Landed on via the `?token=` link inside every guest thread-follow email (the
  per-subscription token only those emails carry). Fires the backend
  unsubscribe once on the token, then shows a clear success/invalid state. No
  form: the token IS the action — clicking the emailed link is the consent
  revocation, so we do not ask for confirmation or credentials (the
  subscriber has no account to log into). Mirrors comment-reply-unsubscribe.vue.

  Route lives at /comment-subscribe/unsubscribe (flat directory, no parent
  page) — the comment-subscribe/ dir holds only confirm.vue and unsubscribe.vue,
  so neither nests under anything (no <NuxtPage> needed).
-->
<script setup lang="ts">
import { ref } from "vue";

const { t } = useLang();

useSeo(() => ({
	title: t("reader.commentSubscribe.unsubSeoTitle"),
	description: t("reader.commentSubscribe.unsubSeoDesc"),
	path: "/comment-subscribe/unsubscribe",
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
		const { unsubscribeGuestThreadSubscription } = await import("~~/api/public/comments");
		await unsubscribeGuestThreadSubscription(token.value);
		state.value = "done";
	} catch (e) {
		// A 404 = unknown/spent token (the only business-level answer the
		// endpoint gives; it is also what a random guess gets). Anything else
		// (no response: unreachable backend) is a NETWORK condition — the token
		// may still be valid, so we must not claim the link is spent.
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
		<div
			class="rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 text-center"
		>
			<h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">
				{{ t("reader.commentSubscribe.unsubTitle") }}
			</h1>

			<div v-if="state === 'pending'" role="status" class="mt-3">
				<Icon icon="lucide:loader-2" class="w-6 h-6 animate-spin text-blue-500 mx-auto" />
				<p class="text-sm text-gray-500 dark:text-gray-400 mt-3">
					{{ t("reader.commentSubscribe.unsubProcessing") }}
				</p>
			</div>
			<p v-else-if="state === 'done'" role="status" class="mt-3 text-sm text-emerald-700 dark:text-emerald-400">
				{{ t("reader.commentSubscribe.unsubSuccess") }}
			</p>
			<p v-else-if="state === 'invalid'" role="status" class="mt-3 text-sm text-amber-700 dark:text-amber-400">
				{{ t("reader.commentSubscribe.unsubInvalid") }}
			</p>
			<p v-else role="status" class="mt-3 text-sm text-red-600 dark:text-red-400">
				{{ t("reader.commentSubscribe.networkError") }}
			</p>
		</div>
	</div>
</template>
