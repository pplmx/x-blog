<!--
  Guest thread-follow confirmation (DEC-427, TASK-438).

  Landed on via the `?token=` link inside the double opt-in confirmation email
  for a guest thread-follow (the per-subscription token only that email
  carries). Fires the backend confirm once on the token, then shows a clear
  success/invalid state. No form: the token IS the action — clicking the
  emailed link is the consent grant, so we do not ask for confirmation or
  credentials (there is no account to log into). Mirrors newsletter/confirm.vue.

  Route lives at /comment-subscribe/confirm (flat directory, no parent page) —
  the comment-subscribe/ dir holds only confirm.vue and unsubscribe.vue, so
  neither nests under anything (no <NuxtPage> needed).
-->
<script setup lang="ts">
import { computed, ref } from "vue";

const { t } = useLang();

useSeo(() => ({
	title: t("reader.commentSubscribe.confirmSeoTitle"),
	description: t("reader.commentSubscribe.confirmSeoDesc"),
	path: "/comment-subscribe/confirm",
}));

const route = useRoute();
const token = computed(() => {
	const v = route.query.token;
	return typeof v === "string" && v ? v : "";
});

const state = ref<"pending" | "done" | "invalid" | "unsubscribed" | "error">("pending");
// Weekly-digest cadence toggle (round 381, DEC-429): once confirmed, the
// holder can switch to (or back from) a weekly summary instead of a mail per
// approved comment, using the same token the confirm link carried — terminal
// per-comment reminders stay the default (newsletter confirm parity).
const digestOn = ref(false);
const digestToggling = ref(false);
const digestToggleError = ref(false);
// Bumped whenever a toggle finishes (success or failure) so the checkbox is
// re-created with the server-truth :checked — on an error digestOn does not
// change value, and without a key bump Vue would leave the DOM checkbox stuck
// where the user clicked it instead of snapping it back.
const digestRenderKey = ref(0);
async function setDigest(enabled: boolean) {
	if (!token.value || digestToggling.value) return;
	digestToggling.value = true;
	digestToggleError.value = false;
	try {
		const { setGuestThreadDigest } = await import("~~/api/public/comments");
		await setGuestThreadDigest(token.value, enabled);
		digestOn.value = enabled;
	} catch {
		digestToggleError.value = true;
	} finally {
		digestToggling.value = false;
		digestRenderKey.value += 1;
	}
}

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
		const { confirmGuestThreadSubscription } = await import("~~/api/public/comments");
		const { digest_weekly } = await confirmGuestThreadSubscription(token.value);
		// Seed the cadence checkbox from the server's answer — a weekly opt-in
		// made at subscribe time must show checked, not the per-comment default.
		digestOn.value = digest_weekly;
		state.value = "done";
	} catch (e) {
		// A 404 = unknown/spent token (the only business-level answer the
		// endpoint gives; it is also what a random guess gets). A 400 = the
		// address was deliberately unsubscribed and this is a replayed confirm
		// link (round-393 consent-restart gate) — it gets its own re-subscribe
		// state, not a "retry the link" message. Anything else (no response:
		// unreachable backend) is a NETWORK condition — the token may still be
		// valid, so we must not claim the link is spent.
		const status =
			(e as { response?: { status?: number } } | undefined)?.response?.status ??
			(e as { status?: number } | undefined)?.status;
		if (status === 400) state.value = "unsubscribed";
		else state.value = status === 404 ? "invalid" : "error";
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
				{{ t("reader.commentSubscribe.confirmTitle") }}
			</h1>

			<div v-if="state === 'pending'" role="status" class="mt-3">
				<Icon icon="lucide:loader-2" class="w-6 h-6 animate-spin text-blue-500 mx-auto" />
				<p class="text-sm text-gray-500 dark:text-gray-400 mt-3">
					{{ t("reader.commentSubscribe.confirmProcessing") }}
				</p>
			</div>
			<div v-else-if="state === 'done'" class="mt-3">
				<!-- The success line alone is the live region; the operable
					 cadence checkbox sits OUTSIDE it, so AT never re-announces
					 the control (newsletter confirm parity). -->
				<p role="status" class="text-sm text-emerald-700 dark:text-emerald-400">
					{{ t("reader.commentSubscribe.confirmSuccess") }}
				</p>
				<label
					class="mt-4 inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer"
				>
					<input
						type="checkbox"
						class="accent-blue-600"
						:key="digestRenderKey"
						:checked="digestOn"
						:disabled="digestToggling"
						@change="(e: Event) => setDigest((e.target as HTMLInputElement).checked)"
					/>
					{{ t("reader.commentSubscribe.confirmDigestWeekly") }}
				</label>
				<p v-if="digestToggling" role="status" class="text-xs text-gray-500 dark:text-gray-400 mt-1">
					{{ t("reader.commentSubscribe.confirmDigestSaving") }}
				</p>
				<p v-if="digestToggleError" role="alert" class="text-xs text-red-600 dark:text-red-400 mt-1">
					{{ t("reader.commentSubscribe.confirmDigestError") }}
				</p>
			</div>
			<p v-else-if="state === 'invalid'" role="status" class="mt-3 text-sm text-amber-700 dark:text-amber-400">
				{{ t("reader.commentSubscribe.confirmInvalid") }}
			</p>
			<p
				v-else-if="state === 'unsubscribed'"
				role="status"
				class="mt-3 text-sm text-amber-700 dark:text-amber-400"
			>
				{{ t("reader.commentSubscribe.confirmUnsubscribed") }}
			</p>
			<p v-else role="status" class="mt-3 text-sm text-red-600 dark:text-red-400">
				{{ t("reader.commentSubscribe.networkError") }}
			</p>
		</div>
	</div>
</template>
