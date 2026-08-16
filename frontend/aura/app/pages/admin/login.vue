<!--
  Admin Login Page
  Migrated from Next.js /app/admin/login/page.tsx to Nuxt 4 / Vue 3.
  Uses useAdminAuth composable for token storage + navigation.
-->
<script setup lang="ts">
import { ref } from "vue";
import { adminLoginRequest, useAdminAuth } from "~~/composables/useAdminAuth";

definePageMeta({ layout: "admin" });

const { t } = useLang();

useHead({ title: computed(() => t("admin.login.seoTitle")) });

const { login } = useAdminAuth();
const username = ref("");
const password = ref("");
const error = ref<string | null>(null);
const isPending = ref(false);

async function handleLogin() {
	if (!(username.value && password.value)) return;

	error.value = null;
	isPending.value = true;

	try {
		const { data, error: fetchError } = await adminLoginRequest(username.value, password.value);

		if (fetchError.value) {
			error.value = t("admin.login.errors.invalidCredentials");
			return;
		}

		if (data.value?.access_token) {
			login(data.value.access_token);
			navigateTo("/admin/posts", { replace: true });
		} else {
			error.value = t("admin.login.errors.noToken");
		}
	} catch {
		error.value = t("admin.login.errors.network");
	} finally {
		isPending.value = false;
	}
}
</script>

<template>
  <div class="w-full max-w-md">
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 p-8">
      <div class="text-center mb-8">
        <div
          class="w-16 h-16 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 flex items-center justify-center mx-auto mb-4"
        >
          <Icon icon="lucide:lock" class="w-8 h-8 text-white" />
        </div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {{ t("admin.login.title") }}
        </h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {{ t("admin.login.subtitle") }}
        </p>
      </div>

      <form @submit.prevent="handleLogin" class="space-y-5">
        <div>
          <label
            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >{{ t("admin.login.username") }}
          </label>
          <input
            v-model="username"
            type="text"
            :placeholder="t('admin.login.usernamePlaceholder')"
            required
            class="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
        </div>

        <div>
          <label
            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >{{ t("admin.login.password") }}
          </label>
          <input
            v-model="password"
            type="password"
            :placeholder="t('admin.login.passwordPlaceholder')"
            required
            class="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
        </div>

        <div v-if="error" class="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p class="text-sm text-red-600 dark:text-red-400">
            {{ error }}
          </p>
        </div>

        <button
          type="submit"
          :disabled="isPending || !username || !password"
          class="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-medium hover:from-blue-600 hover:to-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md shadow-blue-500/20"
        >
          <span v-if="isPending" class="flex items-center justify-center gap-2">
            <Icon icon="lucide:loader-2" class="w-4 h-4 animate-spin" />
            {{ t("admin.login.loggingIn") }}
          </span>
          <span v-else>{{ t("admin.login.login") }}</span>
        </button>
      </form>
      <div class="mt-6 pt-6 border-t text-center">
        <NuxtLink
          to="/"
          class="text-sm text-gray-500 hover:text-blue-600 transition-colors"
        >
          ← {{ t("admin.login.backToBlog") }}
        </NuxtLink>
      </div>
    </div>
  </div>
</template>

<!--
  Page layout is set via definePageMeta({ layout: "admin" }) in <script setup>
  (Nuxt 4 removed the Options-API `layout` property). The admin layout renders
  the login card without the sidebar and handles the unauth redirect.
-->
