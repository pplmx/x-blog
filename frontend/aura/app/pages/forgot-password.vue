<!--
  Forgot-password request (DEC-286, TASK-371).

  The entry to reader password recovery: enter the registered email, get a
  reset link by mail. Deliberately shows a generic success message whether or
  not the address exists — the backend avoids an account-existence oracle —
  and surfaces only infrastructure errors (503 = email service unavailable).
-->
<script setup lang="ts">
import { ref } from "vue";

const { t } = useLang();

useSeo(() => ({
	title: t("reader.forgotPassword.seoTitle"),
	description: t("reader.forgotPassword.seoDesc"),
	path: "/forgot-password",
}));

const email = ref("");
const error = ref<string | null>(null);
const sent = ref(false);
const isPending = ref(false);

async function handleSubmit() {
	if (isPending.value || sent.value) return;
	if (!email.value) return;
	error.value = null;
	isPending.value = true;
	try {
		const { requestPasswordReset } = await import("~~/api/reader/auth");
		const { data, error: qerr } = await requestPasswordReset({ email: email.value });
		if (qerr.value) {
			// A 503 is the only account-agnostic "email service is down" signal;
			// anything else failed the network call.
			const status =
				(qerr.value as { statusCode?: number } | undefined)?.statusCode ??
				(qerr.value as { status?: number } | undefined)?.status;
			throw new Error(status === 503 ? t("reader.forgotPassword.errors.service") : "network");
		}
		void data.value;
		sent.value = true;
	} catch (e) {
		const msg = e instanceof Error ? e.message : "network";
		error.value = msg === "network" ? t("reader.forgotPassword.errors.network") : msg;
	} finally {
		isPending.value = false;
	}
}
</script>

<template>
  <div class="max-w-md mx-auto px-4 py-12">
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 p-8">
      <div class="text-center mb-8">
        <div
          class="w-16 h-16 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 flex items-center justify-center mx-auto mb-4"
        >
          <Icon icon="lucide:key-round" class="w-8 h-8 text-white" />
        </div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {{ t("reader.forgotPassword.title") }}
        </h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {{ t("reader.forgotPassword.subtitle") }}
        </p>
      </div>

      <form v-if="!sent" @submit.prevent="handleSubmit" class="space-y-5">
        <div>
          <label
            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >{{ t("reader.forgotPassword.email") }}
          </label>
          <input
            v-model="email"
            type="email"
            autocomplete="email"
            :placeholder="t('reader.forgotPassword.emailPlaceholder')"
            required
            class="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
        </div>

        <div
          v-if="error"
          role="alert"
          class="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg"
        >
          <p class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
        </div>

        <button
          type="submit"
          :disabled="isPending || !email"
          class="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-medium hover:from-blue-600 hover:to-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md shadow-blue-500/20"
        >
          <span v-if="isPending" class="flex items-center justify-center gap-2">
            <Icon icon="lucide:loader-2" class="w-4 h-4 animate-spin" />
            {{ t("reader.forgotPassword.submitting") }}
          </span>
          <span v-else>{{ t("reader.forgotPassword.submit") }}</span>
        </button>
      </form>

      <div
        v-else
        role="status"
        class="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg"
      >
        <p class="text-sm text-green-700 dark:text-green-300">
          {{ t("reader.forgotPassword.sent") }}
        </p>
      </div>

      <div class="mt-6 pt-6 border-t text-center">
        <NuxtLink
          to="/login"
          class="text-sm text-gray-500 hover:text-blue-600 transition-colors"
        >
          ← {{ t("reader.forgotPassword.backToLogin") }}
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
