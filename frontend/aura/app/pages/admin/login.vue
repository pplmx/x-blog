<!--
  Admin Login Page
  Migrated from Next.js /app/admin/login/page.tsx to Nuxt 4 / Vue 3.
  Uses useAdminAuth composable for token storage + navigation.
-->
<script setup lang="ts">
import { ref } from "vue";
import { adminLoginRequest, useAdminAuth } from "~~/composables/useAdminAuth";

useHead({ title: "管理员登录 - X-Blog" });



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
			error.value = "登录失败：用户名或密码错误";
			return;
		}

		if (data.value?.access_token) {
			login(data.value.access_token);
			navigateTo("/admin/posts", { replace: true });
		} else {
			error.value = "登录失败：未收到访问令牌";
		}
	} catch {
		error.value = "登录失败：网络错误";
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
          管理员登录
        </h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
          请输入管理员账号密码
        </p>
      </div>

      <form @submit.prevent="handleLogin" class="space-y-5">
        <div>
          <label
            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >用户名
          </label>
          <input
            v-model="username"
            type="text"
            placeholder="用户名"
            required
            class="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
        </div>

        <div>
          <label
            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >密码
          </label>
          <input
            v-model="password"
            type="password"
            placeholder="密码"
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
            登录中...
          </span>
          <span v-else>登录</span>
        </button>
      </form>
      <div class="mt-6 pt-6 border-t text-center">
        <NuxtLink
          to="/"
          class="text-sm text-gray-500 hover:text-blue-600 transition-colors"
        >
          ← 返回博客首页
        </NuxtLink>
      </div>
    </div>
  </div>
</template>

<!--
  Use the admin layout (no sidebar for login page)
-->
<script lang="ts">
export default {
  layout: 'admin',
  auth: false,
};
</script>
