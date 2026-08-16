<!--
  Admin layout — wraps all /admin/* pages with a sidebar navigation.
  Shows the sidebar + main content when authenticated, otherwise renders
  the login page without the sidebar.

  Migrated from Next.js /app/admin/layout.tsx to Nuxt 4 / Vue 3.
  Uses useAdminAuth composable for auth state + logout.
-->
<script setup lang="ts">
import { useAdminAuth } from "~~/composables/useAdminAuth";

const { isAuthenticated, logout } = useAdminAuth();
const { t } = useLang();
const route = useRoute();
const isLoginPage = route.path === "/admin/login";
const sidebarOpen = ref(false);

// Redirect unauthenticated users to the login page — CLIENT-side only
// (typeof window guard). The token lives in localStorage, which does not
// exist during SSR; a server-side check would 302-redirect every admin
// page (including for logged-in users) before the client can read the token.
if (typeof window !== "undefined" && !(isAuthenticated.value || isLoginPage)) {
	navigateTo("/admin/login", { replace: true });
}

const showPasswordModal = ref(false);
const passwordForm = ref({ current_password: "", new_password: "", confirm: "" });
const passwordError = ref<string | null>(null);
const passwordSuccess = ref(false);

async function handleChangePassword() {
	passwordError.value = null;
	passwordSuccess.value = false;
	if (passwordForm.value.new_password.length < 8) {
		passwordError.value = t("admin.password.minLength");
		return;
	}
	if (passwordForm.value.new_password !== passwordForm.value.confirm) {
		passwordError.value = t("admin.password.mismatch");
		return;
	}
	try {
		const config = useRuntimeConfig();
		const apiUrl = config.public.apiUrl;
		const token = localStorage.getItem("admin_token");
		const res = await fetch(`${apiUrl}/api/admin/password`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
			body: JSON.stringify({
				current_password: passwordForm.value.current_password,
				new_password: passwordForm.value.new_password,
			}),
		});
		if (!res.ok) {
			const data = await res.json();
			throw new Error(data?.detail || "Failed to change password");
		}
		passwordSuccess.value = true;
		passwordForm.value = { current_password: "", new_password: "", confirm: "" };
		setTimeout(() => {
			showPasswordModal.value = false;
		}, 1500);
	} catch (err) {
		passwordError.value = err instanceof Error ? err.message : t("admin.password.failed");
	}
}

// Close mobile sidebar when route changes
watch(
	() => route.path,
	() => {
		sidebarOpen.value = false;
	},
);

// Navigation items matching the Next.js admin layout
const navItems = [
	{ href: "/admin", labelKey: "admin.nav.dashboard", icon: "lucide:layout-dashboard" },
	{ href: "/admin/posts", labelKey: "admin.nav.posts", icon: "lucide:file-text" },
	{ href: "/admin/comments", labelKey: "admin.nav.comments", icon: "lucide:message-circle" },
	{ href: "/admin/categories", labelKey: "admin.nav.categories", icon: "lucide:folder" },
	{ href: "/admin/tags", labelKey: "admin.nav.tags", icon: "lucide:tag" },
	{ href: "/admin/users", labelKey: "admin.nav.users", icon: "lucide:users" },
];
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900">
    <!-- Login page — no sidebar -->
    <div v-if="isLoginPage" class="min-h-screen flex items-center justify-center">
      <slot />
    </div>

    <!-- Authenticated layout — with sidebar -->
    <div v-else-if="isAuthenticated" class="flex min-h-screen">
      <!-- Mobile overlay -->
      <div
        v-if="sidebarOpen"
        class="fixed inset-0 bg-black/50 z-40 lg:hidden"
        @click="sidebarOpen = false"
        aria-hidden="true"
      />

      <!-- Sidebar -->
      <aside
        class="fixed lg:static inset-y-0 left-0 z-50 w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 min-h-screen transform transition-transform duration-200"
        :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'"
      >
        <div class="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-xl font-bold text-gray-900 dark:text-gray-100">
            {{ t('admin.title') }}
          </h2>
          <button
            type="button"
            class="lg:hidden p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            @click="sidebarOpen = false"
            :aria-label="t('common.menu.close')"
          >
            <Icon icon="lucide:x" class="w-5 h-5" />
          </button>
        </div>

        <nav class="p-3 space-y-0.5">
          <NuxtLink
            v-for="item in navItems"
            :key="item.href"
            :to="item.href"
            :class="[
              'flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
              route.path === item.href
                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200',
            ]"
            @click="sidebarOpen = false"
          >
            <Icon :icon="item.icon" class="w-4 h-4" />
            {{ t(item.labelKey) }}
          </NuxtLink>

          <div class="my-3 border-t border-gray-100 dark:border-gray-700/50" />

          <NuxtLink
            to="/"
            class="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200 transition-all duration-200"
            @click="sidebarOpen = false"
          >
            <Icon icon="lucide:arrow-left" class="w-4 h-4" />
            {{ t('admin.backToSite') }}
          </NuxtLink>

          <button
            type="button"
            class="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200 transition-all duration-200 w-full"
            @click="showPasswordModal = true"
          >
            <Icon icon="lucide:key-round" class="w-4 h-4" />
            {{ t('admin.changePassword') }}
          </button>

          <button
            type="button"
            class="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 transition-all duration-200 w-full"
            @click="logout"
          >
            <Icon icon="lucide:log-out" class="w-4 h-4" />
            {{ t('admin.logout') }}
          </button>
        </nav>
      </aside>

      <!-- Main content -->
      <div class="flex-1 flex flex-col min-h-screen">
        <!-- Mobile header -->
        <header class="lg:hidden border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 flex items-center">
          <button
            type="button"
            class="p-2 -ml-2 mr-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
            @click="sidebarOpen = true"
            :aria-label="t('common.menu.open')"
          >
            <Icon icon="lucide:menu" class="w-6 h-6" />
          </button>
          <span class="font-bold text-gray-900 dark:text-gray-100">{{ t('admin.title') }}</span>
        </header>

        <main class="flex-1 p-6 lg:p-8 overflow-x-auto">
          <slot />
        </main>
      </div>
    </div>

    <!-- Password modal -->
    <Teleport to="body">
      <div
        v-if="showPasswordModal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        @click.self="showPasswordModal = false"
      >
        <div class="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm mx-4">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{{ t('admin.password.title') }}</h3>

          <div v-if="passwordSuccess" class="p-3 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-xl text-sm mb-4">
            {{ t('admin.password.success') }}
          </div>

          <form @submit.prevent="handleChangePassword" class="space-y-4">
            <div>
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">{{ t('admin.password.current') }}</label>
              <input
                v-model="passwordForm.current_password"
                type="password"
                required
                class="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              >
            </div>
            <div>
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">{{ t('admin.password.new') }}</label>
              <input
                v-model="passwordForm.new_password"
                type="password"
                required
                minlength="8"
                class="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              >
            </div>
            <div>
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">{{ t('admin.password.confirm') }}</label>
              <input
                v-model="passwordForm.confirm"
                type="password"
                required
                class="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              >
            </div>

            <div v-if="passwordError" class="text-sm text-red-500">{{ passwordError }}</div>

            <div class="flex gap-3 pt-2">
              <button type="submit" class="flex-1 px-4 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium hover:bg-blue-600 transition-colors">
                {{ t('common.action.save') }}
              </button>
              <button type="button" class="flex-1 px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors" @click="showPasswordModal = false">
                {{ t('common.action.cancel') }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>
