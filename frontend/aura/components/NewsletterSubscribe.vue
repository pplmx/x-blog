<script setup lang="ts">
/**
 * Footer newsletter subscribe (DEC-351, TASK-401).
 *
 * The anonymous "email me new posts" on-ramp: a bare email input and button
 * (no account, no comment). POSTs once to the backend, which always answers
 * with the same generic message (no email-existence oracle) and mails a
 * double opt-in confirmation link; the address stays quiet until confirmed.
 * Success state is deliberately generic ("check your inbox") so subscribing
 * someone else's address is never distinguishable from subscribing your own.
 */
import { ref, watch } from "vue";

const { t } = useLang();
const email = ref("");
// Weekly-digest cadence (DEC-355, TASK-403): chose once at subscribe time; it
// is stored on the row and honored only after the double opt-in completes.
const digest = ref(false);
const state = ref<"idle" | "submitting" | "done" | "error">("idle");
const submitting = ref(false);
let submitSeq = 0;

// A terminal state (done/error) belongs to the address that produced it; the
// moment the user edits the field that state is stale. Reset so a corrected
// address doesn't sit under a leftover "check your inbox" / failure message.
// An empty new value is the programmatic post-success clear, not a user edit —
// keep the success message; only a newly typed address resets the state.
watch(email, (value) => {
	if (!value) return;
	if (state.value === "done" || state.value === "error") state.value = "idle";
});

async function submit() {
	const value = email.value.trim();
	if (!value || submitting.value) return;
	submitting.value = true;
	state.value = "submitting";
	const seq = ++submitSeq;
	try {
		const { subscribeNewsletter } = await import("~~/api/public/newsletter");
		await subscribeNewsletter(value, digest.value);
		if (seq !== submitSeq) return; // a newer submission superseded us
		email.value = "";
		state.value = "done";
	} catch {
		if (seq !== submitSeq) return;
		state.value = "error";
	} finally {
		if (seq === submitSeq) submitting.value = false;
	}
}
</script>

<template>
  <form class="flex flex-col gap-2 w-full sm:max-w-sm" @submit.prevent="submit">
    <div class="flex flex-col sm:flex-row gap-2">
      <label class="sr-only" for="newsletter-email">{{ t("components.newsletter.label") }}</label>
      <input
        id="newsletter-email"
        v-model="email"
        type="email"
        required
        autocomplete="email"
        :placeholder="t('components.newsletter.placeholder')"
        :disabled="submitting"
        class="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <button
        type="submit"
        :disabled="submitting"
        class="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <Icon v-if="submitting" icon="lucide:loader-2" class="w-4 h-4 animate-spin" />
        <Icon v-else icon="lucide:mail" class="w-4 h-4" />
        {{ submitting ? t("components.newsletter.submitting") : t("components.newsletter.subscribe") }}
      </button>
    </div>
    <label class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
      <input
        v-model="digest"
        type="checkbox"
        class="accent-blue-600"
        :disabled="submitting"
      />
      {{ t("components.newsletter.digestWeekly") }}
    </label>
  </form>
  <p v-if="state === 'done'" role="status" class="text-sm text-green-600 dark:text-green-400">
    {{ t("components.newsletter.done") }}
  </p>
  <p v-else-if="state === 'error'" role="status" class="text-sm text-red-600 dark:text-red-400">
    {{ t("components.newsletter.error") }}
  </p>
</template>
