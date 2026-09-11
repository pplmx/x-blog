<!--
  Password-reset redemption (DEC-286, TASK-371).

  Landed on via the emailed ?token= link. Validates a matching password pair,
  redeems the token (auto-login on the backend), adopts the fresh session and
  routes to /account. An invalid/expired token surfaces a friendly message with
  a re-request link.
-->
<script setup lang="ts">
import { ref } from "vue";

import { useReaderAuth } from "~~/composables/useReaderAuth";

const readerAuth = useReaderAuth();
const { t } = useLang();

useSeo(() => ({
	title: t("reader.resetPassword.seoTitle"),
	description: t("reader.resetPassword.seoDesc"),
	path: "/reset-password",
}));

const route = useRoute();
const token = computed(() => {
	const t = route.query.token;
	return typeof t === "string" && t ? t : "";
});

const password = ref("");
const confirm = ref("");
const error = ref<string | null>(null);
const done = ref(false);
const isPending = ref(false);

async function handleSubmit() {
	if (isPending.value || done.value) return;
	if (!token.value || !password.value) return;
	error.value = null;
	if (password.value !== confirm.value) {
		error.value = t("reader.resetPassword.mismatch");
		return;
	}
	isPending.value = true;
	try {
		await readerAuth.resetPassword(token.value, password.value);
		done.value = true;
		await navigateTo("/account", { replace: true });
	} catch (e) {
		const status =
			(e as { statusCode?: number } | undefined)?.statusCode ??
			(e as { status?: number } | undefined)?.status;
		// A redeemed (already-used/expired/invalid) token is a business-level 400
		// from the backend — the reset page must not claim a network failure.
		error.value =
			status === 400 ? t("reader.resetPassword.invalid") : t("reader.resetPassword.errors.network");
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
          <Icon icon="lucide:shield-check" class="w-8 h-8 text-white" />
        </div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {{ t("reader.resetPassword.title") }}
        </h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {{ t("reader.resetPassword.subtitle") }}
        </p>
      </div>

      <form v-if="!done && token" @submit.prevent="handleSubmit" class="space-y-5">
        <div>
          <label
            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >{{ t("reader.resetPassword.password") }}
          </label>
          <input
            v-model="password"
            type="password"
            autocomplete="new-password"
            :placeholder="t('reader.resetPassword.passwordPlaceholder')"
            required
            :minlength="8"
            class="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
        </div>

        <div>
          <label
            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >{{ t("reader.resetPassword.confirm") }}
          </label>
          <input
            v-model="confirm"
            type="password"
            autocomplete="new-password"
            :placeholder="t('reader.resetPassword.confirmPlaceholder')"
            required
            :minlength="8"
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
          :disabled="isPending || !password || !confirm"
          class="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-medium hover:from-blue-600 hover:to-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md shadow-blue-500/20"
        >
          <span v-if="isPending" class="flex items-center justify-center gap-2">
            <Icon icon="lucide:loader-2" class="w-4 h-4 animate-spin" />
            {{ t("reader.resetPassword.submitting") }}
          </span>
          <span v-else>{{ t("reader.resetPassword.submit") }}</span>
        </button>
      </form>

      <div
        v-else-if="!token"
        role="status"
        class="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg"
      >
        <p class="text-sm text-amber-700 dark:text-amber-300">
          {{ t("reader.resetPassword.invalid") }}
        </p>
      </div>

      <div class="mt-6 pt-6 border-t text-center">
        <NuxtLink
          :to="token ? '/forgot-password' : '/login'"
          class="text-sm text-gray-500 hover:text-blue-600 transition-colors"
        >
          ← {{ t("reader.forgotPassword.backToLogin") }}
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
