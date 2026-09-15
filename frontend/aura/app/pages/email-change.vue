<!--
  Reader email-change redemption (DEC-357, TASK-404).

  Landed on via the `?token=` link inside the verification email that the
  account page mailed to the NEW address. Fires the backend confirm once on
  the token: on success the email is swapped, token_version is bumped (every
  prior session is revoked) and a fresh auto-login session is adopted, then we
  route to /account. No form: the emailed link IS the action — the token is the
  credential, and the fallback for a spent link is to re-request from the
  account page. Invalid/used/expired links (400) and a target address that got
  taken while the link sat pending (409) each get their own state; a network
  failure is clearly NOT a spent link (mirrors newsletter/confirm.vue).
-->
<script setup lang="ts">
import { ref } from "vue";

import { useReaderAuth } from "~~/composables/useReaderAuth";

const readerAuth = useReaderAuth();
const { t } = useLang();

useSeo(() => ({
	title: t("reader.emailChange.seoTitle"),
	description: t("reader.emailChange.seoDesc"),
	path: "/email-change",
}));

const route = useRoute();
const token = computed(() => {
	const v = route.query.token;
	return typeof v === "string" && v ? v : "";
});

const state = ref<"pending" | "done" | "taken" | "invalid" | "error">("pending");

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
		await readerAuth.confirmEmailChange(token.value);
		state.value = "done";
	} catch (e) {
		// A 400 = invalid/used/expired link, 409 = target taken while pending —
		// both business-level answers. Anything else (no response: unreachable
		// backend) is a NETWORK condition — the token may still be valid, so we
		// must not tell the holder their link is spent. Only these failures
		// touch state; a navigation error is NOT a redemption failure.
		const status =
			(e as { statusCode?: number } | undefined)?.statusCode ??
			(e as { response?: { status?: number } } | undefined)?.response?.status;
		if (status === 409) state.value = "taken";
		else if (status === 400) state.value = "invalid";
		else state.value = "error";
		return;
	}
	// Route only after a truthful success is fixed — a rejecting navigateTo
	// (e.g. middleware error, tests) must not overwrite the success state with
	// a network-failure message while the reader is in fact signed in under the
	// new email and the link is already spent (round-342 review).
	await navigateTo("/account", { replace: true });
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
          <Icon icon="lucide:mail-check" class="w-8 h-8 text-white" />
        </div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {{ t("reader.emailChange.title") }}
        </h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {{ t("reader.emailChange.subtitle") }}
        </p>
      </div>

      <div v-if="state === 'pending'" role="status" class="text-center">
        <Icon icon="lucide:loader-2" class="w-6 h-6 animate-spin text-blue-500 mx-auto" />
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-3">
          {{ t("reader.emailChange.processing") }}
        </p>
      </div>

      <div
        v-else-if="state === 'done'"
        role="status"
        class="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-center"
      >
        <p class="text-sm text-green-700 dark:text-green-300">
          {{ t("reader.emailChange.success") }}
        </p>
      </div>

      <div
        v-else-if="state === 'taken'"
        role="status"
        class="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg"
      >
        <p class="text-sm text-amber-700 dark:text-amber-300">
          {{ t("reader.emailChange.taken") }}
        </p>
      </div>

      <div
        v-else-if="state === 'error'"
        role="status"
        class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg"
      >
        <p class="text-sm text-red-600 dark:text-red-400">
          {{ t("reader.emailChange.errors.network") }}
        </p>
      </div>

      <div
        v-else
        role="status"
        class="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg"
      >
        <p class="text-sm text-amber-700 dark:text-amber-300">
          {{ t("reader.emailChange.invalid") }}
        </p>
      </div>

      <div
        v-if="state === 'taken' || state === 'invalid'"
        class="mt-6 pt-6 border-t text-center"
      >
        <NuxtLink to="/account" class="text-sm text-gray-500 hover:text-blue-600 transition-colors">
          ← {{ t("reader.emailChange.backToAccount") }}
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
