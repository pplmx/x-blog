<!--
  Reader login / register (DEC-059, TASK-133).

  A single page toggling between sign-in and sign-up for reader accounts —
  the identity layer for cloud-synced bookmarks. Credentials are sent to
  /api/reader/login | /api/reader/register; the returned reader JWT is stored
  by useReaderAuth (distinct from admin auth).
-->
<script setup lang="ts">
import { ref } from "vue";

import { useReaderAuth } from "~~/composables/useReaderAuth";

const { t } = useLang();

useSeo({
	title: t("reader.login.seoTitle"),
	description: t("reader.login.seoDesc"),
	path: "/login",
});

const { login, register } = useReaderAuth();

const mode = ref<"login" | "register">("login");
const email = ref("");
const password = ref("");
const displayName = ref("");
const error = ref<string | null>(null);
const isPending = ref(false);

async function handleSubmit() {
	if (!(email.value && password.value)) return;
	error.value = null;
	isPending.value = true;
	try {
		if (mode.value === "register") {
			await register(email.value, password.value, displayName.value || undefined);
		} else {
			await login(email.value, password.value);
		}
		navigateTo("/bookmarks", { replace: true });
	} catch (e) {
		error.value = e instanceof Error ? e.message : t("reader.login.errors.network");
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
          <Icon icon="lucide:bookmark" class="w-8 h-8 text-white" />
        </div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {{ mode === "login" ? t("reader.login.title") : t("reader.login.registerTitle") }}
        </h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {{ mode === "login" ? t("reader.login.subtitle") : t("reader.login.registerSubtitle") }}
        </p>
      </div>

      <!-- Mode toggle -->
      <div class="grid grid-cols-2 gap-1 p-1 bg-gray-100 dark:bg-gray-900 rounded-xl mb-6">
        <button
          type="button"
          class="py-2 text-sm font-medium rounded-lg transition-colors"
          :class="mode === 'login'
            ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'"
          @click="mode = 'login'"
        >
          {{ t("reader.login.hasAccount") }}
        </button>
        <button
          type="button"
          class="py-2 text-sm font-medium rounded-lg transition-colors"
          :class="mode === 'register'
            ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'"
          @click="mode = 'register'"
        >
          {{ t("reader.login.noAccount") }}
        </button>
      </div>

      <form @submit.prevent="handleSubmit" class="space-y-5">
        <div v-if="mode === 'register'">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {{ t("reader.login.displayName") }}
          </label>
          <input
            v-model="displayName"
            type="text"
            :placeholder="t('reader.login.displayNamePlaceholder')"
            class="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
        </div>

        <div>
          <label
            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >{{ t("reader.login.email") }}
          </label>
          <input
            v-model="email"
            type="email"
            :placeholder="t('reader.login.emailPlaceholder')"
            required
            class="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
        </div>

        <div>
          <label
            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >{{ t("reader.login.password") }}
          </label>
          <input
            v-model="password"
            type="password"
            :placeholder="t('reader.login.passwordPlaceholder')"
            required
            :minlength="mode === 'register' ? 8 : undefined"
            class="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
        </div>

        <div v-if="error" class="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
        </div>

        <button
          type="submit"
          :disabled="isPending || !email || !password"
          class="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-medium hover:from-blue-600 hover:to-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md shadow-blue-500/20"
        >
          <span v-if="isPending" class="flex items-center justify-center gap-2">
            <Icon icon="lucide:loader-2" class="w-4 h-4 animate-spin" />
            {{ mode === "login" ? t("reader.login.loggingIn") : t("reader.login.registering") }}
          </span>
          <span v-else>
            {{ mode === "login" ? t("reader.login.login") : t("reader.login.registerAction") }}
          </span>
        </button>
      </form>

      <div class="mt-6 pt-6 border-t text-center">
        <NuxtLink
          to="/bookmarks"
          class="text-sm text-gray-500 hover:text-blue-600 transition-colors"
        >
          ← {{ t("reader.login.backToBookmarks") }}
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
