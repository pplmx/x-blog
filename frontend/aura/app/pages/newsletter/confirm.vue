<!--
  Guest newsletter confirmation (DEC-351, TASK-401).

  Landed on via the `?token=` link inside the double opt-in confirmation email
  (the per-subscriber token only that email carries). Fires the backend confirm
  once on the token, then shows a clear success/invalid state. No form: the
  token IS the action — clicking the emailed link is the consent grant, so we
  do not ask for confirmation or credentials (there is no account to log into).

  Route lives at /newsletter/confirm (flat, NOT under a newsletter.vue parent):
  the only page files in this directory are confirm.vue and unsubscribe.vue,
  so neither nests under anything — no <NuxtPage> needed.
-->
<script setup lang="ts">
import { ref } from "vue";

const { t } = useLang();

useSeo(() => ({
	title: t("newsletter.confirm.seoTitle"),
	description: t("newsletter.confirm.seoDesc"),
	path: "/newsletter/confirm",
}));

const route = useRoute();
const token = computed(() => {
	const v = route.query.token;
	return typeof v === "string" && v ? v : "";
});

const state = ref<"pending" | "done" | "invalid" | "error">("pending");
// Weekly-digest cadence toggle (DEC-355, TASK-403): once confirmed, the holder
// can switch to (or back from) a weekly summary instead of per-post mail using
// the same token the confirm link carried.
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
		const { setNewsletterDigest } = await import("~~/api/public/newsletter");
		await setNewsletterDigest(token.value, enabled);
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
		const { confirmNewsletter } = await import("~~/api/public/newsletter");
		const { digest_weekly } = await confirmNewsletter(token.value);
		// Seed the cadence checkbox from the server's answer — a digest opt-in
		// made at subscribe time must show as checked, not as the per-post
		// default (DEC-355; only the token holder sees this).
		digestOn.value = digest_weekly;
		state.value = "done";
	} catch (e) {
		// A 404 = unknown token (the only business-level answer the endpoint
		// gives; it is also what a random guess gets). Anything else (no
		// response: unreachable backend) is a NETWORK condition — the token may
		// still be valid, so we must not tell the holder their link is spent.
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
          <Icon icon="lucide:mail-check" class="w-8 h-8 text-white" />
        </div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {{ t("newsletter.confirm.title") }}
        </h1>
      </div>

      <div v-if="state === 'pending'" role="status" class="text-center">
        <Icon icon="lucide:loader-2" class="w-6 h-6 animate-spin text-blue-500 mx-auto" />
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-3">
          {{ t("newsletter.confirm.processing") }}
        </p>
      </div>

      <div
        v-else-if="state === 'done'"
        class="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg"
      >
        <!-- The success line alone is the live region; the operable cadence
             checkbox sits OUTSIDE it, so AT never re-announces the control. -->
        <p role="status" class="text-sm text-green-700 dark:text-green-300">
          {{ t("newsletter.confirm.success") }}
        </p>
        <label class="mt-4 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            class="accent-blue-600"
            :key="digestRenderKey"
            :checked="digestOn"
            :disabled="digestToggling"
            @change="(e: Event) => setDigest((e.target as HTMLInputElement).checked)"
          />
          {{ t("newsletter.confirm.digestWeekly") }}
        </label>
        <p v-if="digestToggling" role="status" class="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {{ t("newsletter.confirm.digestSaving") }}
        </p>
        <p v-if="digestToggleError" role="alert" class="text-xs text-red-600 dark:text-red-400 mt-1">
          {{ t("newsletter.confirm.digestError") }}
        </p>
      </div>

      <div
        v-else-if="state === 'error'"
        role="status"
        class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg"
      >
        <p class="text-sm text-red-600 dark:text-red-400">
          {{ t("newsletter.confirm.errors.network") }}
        </p>
      </div>

      <div
        v-else
        role="status"
        class="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg"
      >
        <p class="text-sm text-amber-700 dark:text-amber-300">
          {{ t("newsletter.confirm.invalid") }}
        </p>
      </div>
    </div>
  </div>
</template>
