<!--
  Admin layout — wraps all /admin/* pages with a sidebar navigation.
  Shows the sidebar + main content when authenticated, otherwise renders
  the login page without the sidebar.

  Migrated from Next.js /app/admin/layout.tsx to Nuxt 4 / Vue 3.
  Uses useAdminAuth composable for auth state + logout.
-->
<script setup lang="ts">
import { useAdminAuth } from "~/composables/useAdminAuth";

const { isAuthenticated, logout } = useAdminAuth();
const route = useRoute();
const isLoginPage = route.path === "/admin/login";
const sidebarOpen = ref(false);

// Redirect unauthenticated users to login page when not already on it
if (!(isAuthenticated.value || isLoginPage)) {
	navigateTo("/admin/login", { replace: true });
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
	{ href: "/admin", label: "仪表盘", icon: "lucide:layout-dashboard" },
	{ href: "/admin/posts", label: "文章", icon: "lucide:file-text" },
	{ href: "/admin/comments", label: "评论", icon: "lucide:message-circle" },
	{ href: "/admin/categories", label: "分类", icon: "lucide:folder" },
	{ href: "/admin/tags", label: "标签", icon: "lucide:tag" },
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
            X-Blog 管理
          </h2>
          <button
            type="button"
            class="lg:hidden p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            @click="sidebarOpen = false"
            aria-label="关闭菜单"
          >
            <Icon icon="lucide:x" class="w-5 h-5" />
          </button>
        </div>

        <nav class="p-3 space-y-1">
          <NuxtLink
            v-for="item in navItems"
            :key="item.href"
            :to="item.href"
            :class="[
              'flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors',
              route.path === item.href
                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700',
            ]"
            @click="sidebarOpen = false"
          >
            <Icon :icon="item.icon" class="w-4 h-4" />
            {{ item.label }}
          </NuxtLink>

          <!-- Back to foreground -->
          <NuxtLink
            to="/"
            class="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            @click="sidebarOpen = false"
          >
            <Icon icon="lucide:arrow-left" class="w-4 h-4" />
            返回前台
          </NuxtLink>

          <!-- Logout -->
          <button
            type="button"
            class="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30 transition-colors w-full"
            @click="logout"
          >
            <Icon icon="lucide:log-out" class="w-4 h-4" />
            退出登录
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
            aria-label="打开菜单"
          >
            <Icon icon="lucide:menu" class="w-6 h-6" />
          </button>
          <span class="font-bold text-gray-900 dark:text-gray-100">X-Blog 管理</span>
        </header>

        <main class="flex-1 p-6 lg:p-8 overflow-x-auto">
          <slot />
        </main>
      </div>
    </div>
  </div>
</template>
