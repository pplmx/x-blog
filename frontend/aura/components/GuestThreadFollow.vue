<script setup lang="ts">
/**
 * Guest email thread-follow control on a post's comment list (round 380,
 * DEC-427, TASK-438).
 *
 * The anonymous counterpart of ThreadSubscribeButton: thread-follow was
 * reader-gated, so a visitor who just wants to follow THIS discussion by email
 * had no on-ramp but registering. This compact form takes an address, sends a
 * double opt-in confirmation (no oracle, mirroring the newsletter footer), and
 * after the link is clicked the address gets one email per approved comment —
 * never needs an account. Renders nothing for signed-in readers (the reader
 * push thread-follow covers them); always renders for guests so the comment
 * header is not a blank gap when nobody is signed in.
 */
import { ref } from "vue";

import { useLang } from "~~/composables/useLang";
import { useReaderAuth } from "~~/composables/useReaderAuth";

defineOptions({ name: "GuestThreadFollow" });

const props = defineProps<{ postId: number }>();

const { t } = useLang();
const { isAuthenticated } = useReaderAuth();

const email = ref("");
const busy = ref(false);
const state = ref<"idle" | "sent" | "error">("idle");
// A slower first submit must not overwrite a newer one's terminal state (the
// same stale-response guard the sibling follow controls use).
let submitSeq = 0;

async function submit() {
	const value = email.value.trim();
	if (!value || busy.value) return;
	busy.value = true;
	state.value = "idle";
	const seq = ++submitSeq;
	try {
		// Dynamic import like NewsletterSubscribe: keeps the API module out of
		// the eager bundle and lets tests observe the call through a mock.
		const { subscribeGuestThread } = await import("~~/api/public/comments");
		await subscribeGuestThread(props.postId, value);
		if (seq !== submitSeq) return;
		state.value = "sent";
	} catch {
		if (seq !== submitSeq) return;
		state.value = "error";
	} finally {
		if (seq === submitSeq) busy.value = false;
	}
}
</script>

<template>
	<form
		v-if="!isAuthenticated"
		class="flex items-center gap-2"
		@submit.prevent="submit"
	>
		<label class="sr-only" :for="`guest-thread-${postId}`">{{ t("components.commentList.guestFollow.label") }}</label>
		<input
			:id="`guest-thread-${postId}`"
			v-model="email"
			type="email"
			required
			autocomplete="email"
			:placeholder="t('components.commentList.guestFollow.placeholder')"
			:disabled="busy"
			class="w-44 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 py-1.5 text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
		/>
		<button
			type="submit"
			:disabled="busy"
			class="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
		>
			<Icon v-if="busy" icon="lucide:loader-2" class="w-3.5 h-3.5 animate-spin" />
			<Icon v-else icon="lucide:mail-plus" class="w-3.5 h-3.5" />
			{{ t("components.commentList.guestFollow.subscribe") }}
		</button>
		<!-- The confirm email is the only feedback surface the form can offer —
			 the backend is deliberately no-oracle. -->
		<p v-if="state === 'sent'" role="status" class="text-xs text-emerald-600 dark:text-emerald-400">
			{{ t("components.commentList.guestFollow.sent") }}
		</p>
		<p v-else-if="state === 'error'" role="alert" class="text-xs text-red-600 dark:text-red-400">
			{{ t("components.commentList.guestFollow.error") }}
		</p>
	</form>
</template>
