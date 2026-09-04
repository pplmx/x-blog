<!--
  Admin layout — wraps all /admin/* pages with a sidebar navigation.
  Shows the sidebar + main content when authenticated, otherwise renders
  the login page without the sidebar.

  Migrated from Next.js /app/admin/layout.tsx to Nuxt 4 / Vue 3.
  Uses useAdminAuth composable for auth state + logout.
-->
<script setup lang="ts">
import { useAdminAuth } from "~~/composables/useAdminAuth";
import { useTheme } from "~~/composables/useTheme";

const { isAuthenticated, logout } = useAdminAuth();
const { t } = useLang();
const route = useRoute();
// Theme is a shared singleton (useTheme) so the admin UI applies the reader's
// persisted dark-mode preference and the public toggle affects /admin/* too.
const { isDark, initTheme, toggleTheme } = useTheme();
onMounted(initTheme);
// Reactive, not a setup-time snapshot: an unauthenticated user hitting /admin
// is redirected to /admin/login via SPA navigation, and the layout instance is
// reused — a plain `route.path === ...` const would stay false and render
// neither branch, leaving a blank page (e2e: homepage "admin page loads").
const isLoginPage = computed(() => route.path === "/admin/login");
const sidebarOpen = ref(false);
// Mobile drawer focus management (mirrors the password modal's pattern): move
// focus into the drawer on open, trap Tab while it is open, and return focus
// to the opening trigger on close. Desktop is unaffected — the sidebar is a
// permanent static column there (sidebarOpen stays false: the only setter is
// the lg:hidden mobile menu button).
const sidebarCloseRef = ref<HTMLButtonElement | null>(null);
const sidebarAsideRef = ref<HTMLElement | null>(null);
/** Element that opened the mobile drawer — restored on close. */
let sidebarFocusReturn: HTMLElement | null = null;

watch(sidebarOpen, (open) => {
	if (!open) return;
	sidebarFocusReturn =
		document.activeElement instanceof HTMLElement ? document.activeElement : null;
	nextTick(() => sidebarCloseRef.value?.focus());
});

/** Close the mobile drawer and return focus to whatever opened it. */
function closeMobileSidebar() {
	sidebarOpen.value = false;
	nextTick(() => sidebarFocusReturn?.focus());
}

const SIDEBAR_FOCUSABLE = "a[href], button, input, select, textarea";

/** Escape closes the drawer; Tab is trapped inside it while it is open. */
function onSidebarKeydown(e: KeyboardEvent) {
	if (!sidebarOpen.value) return;
	if (e.key === "Escape") {
		closeMobileSidebar();
		return;
	}
	if (e.key !== "Tab") return;
	const aside = sidebarAsideRef.value;
	if (!aside) return;
	const focusables = Array.from(aside.querySelectorAll<HTMLElement>(SIDEBAR_FOCUSABLE)).filter(
		(el) => !el.hasAttribute("disabled"),
	);
	if (focusables.length === 0) return;
	const first = focusables[0];
	const last = focusables[focusables.length - 1];
	if (!first || !last) return;
	const active = document.activeElement;
	if (e.shiftKey && (active === first || !aside.contains(active))) {
		e.preventDefault();
		last.focus();
	} else if (!e.shiftKey && (active === last || !aside.contains(active))) {
		e.preventDefault();
		first.focus();
	}
}

// Current admin's role (superuser | editor). Editors (non-superuser) can
// moderate content but must not see superuser-only sections (users/export/batch).
// The role is stored in localStorage at login time (login.vue) and read
// here. Defaults to superuser when absent — a pre-role session or a failed
// /me read never hides privileged UI from a real superuser. The backend still
// enforces authorization independently (get_current_superuser).
function readStoredRole(): "superuser" | "editor" {
	const stored =
		typeof window !== "undefined" && typeof localStorage?.getItem === "function"
			? localStorage.getItem("admin_role")
			: null;
	return stored === "editor" ? "editor" : "superuser";
}
// Reactive, not a setup-time snapshot: login.vue writes admin_role right before
// SPA-navigating to /admin/posts, so a reuse of this layout instance must see
// the fresh role or an editor would keep the superuser sidebar (Users/export).
const currentRole = ref<"superuser" | "editor">(readStoredRole());
watch(
	() => route.path,
	() => {
		currentRole.value = readStoredRole();
	},
);

// Redirect unauthenticated users to the login page — CLIENT-side only: the
// token lives in localStorage, which does not exist during SSR (a server-side
// check would 302-redirect every admin page, including logged-in users, before
// the client can read the token). The redirect runs in onMounted, not during
// layout setup: navigateTo() during setup/hydration races the still-initializing
// app context and can be silently dropped (e2e: homepage "admin page loads"
// intermittently saw /admin never redirect).
//
// A hard `window.location.replace` (not `navigateTo`) is intentional: an SPA
// navigateTo to another page sharing this same "admin" layout can leave the
// layout's slot empty on the first load (the layout instance is reused, the
// page component never mounts — observed as a blank page at /admin/login after
// the URL changes). A hard load re-renders /admin/login via SSR and hydrates
// reliably. Only unauthenticated visitors hit this path.
onMounted(() => {
	if (!isAuthenticated.value && !isLoginPage.value) {
		window.location.replace("/admin/login");
	}
});

const showPasswordModal = ref(false);
const passwordForm = ref({ current_password: "", new_password: "", confirm: "" });
const passwordError = ref<string | null>(null);
const passwordSuccess = ref(false);
const passwordBusy = ref(false);
const passwordCurrentInput = ref<HTMLInputElement | null>(null);
const passwordPanelRef = ref<HTMLElement | null>(null);
/** Element to return focus to when the modal closes (the opening trigger). */
let passwordFocusReturn: HTMLElement | null = null;

// Reset transient state and move focus into the first field every time the
// modal reopens, so a fresh open never shows a stale error/success banner.
// Record the opening trigger first so close can restore focus (deep-dive
// re-audit: closing previously dropped focus to <body>, forcing a re-tab
// through the whole sidebar).
watch(showPasswordModal, (open) => {
	if (!open) return;
	passwordError.value = null;
	passwordSuccess.value = false;
	passwordFocusReturn =
		document.activeElement instanceof HTMLElement ? document.activeElement : null;
	nextTick(() => passwordCurrentInput.value?.focus());
});

/** Close the modal and return focus to whatever opened it. */
function closePasswordModal() {
	showPasswordModal.value = false;
	nextTick(() => passwordFocusReturn?.focus());
}

// Focusable elements inside the modal panel, for the Tab trap (mirrors the
// MediaPickerModal pattern applied by the a11y pass).
const PASSWORD_FOCUSABLE = "a[href], button, input, select, textarea";

function onPasswordKeydown(e: KeyboardEvent) {
	if (e.key === "Escape") {
		closePasswordModal();
		return;
	}
	if (e.key !== "Tab") return;
	const panel = passwordPanelRef.value;
	if (!panel) return;
	const focusables = Array.from(panel.querySelectorAll<HTMLElement>(PASSWORD_FOCUSABLE)).filter(
		(el) => !el.hasAttribute("disabled"),
	);
	if (focusables.length === 0) return;
	const first = focusables[0];
	const last = focusables[focusables.length - 1];
	// Narrow the length-checked indexed access for noUncheckedIndexedAccess:
	// a non-empty panel guarantees both ends exist.
	if (!first || !last) return;
	const active = document.activeElement;
	// Wrap Tab/Shift+Tab at the panel boundaries so keyboard focus cannot
	// escape into the page behind the modal.
	if (e.shiftKey && (active === first || !panel.contains(active))) {
		e.preventDefault();
		last.focus();
	} else if (!e.shiftKey && (active === last || !panel.contains(active))) {
		e.preventDefault();
		first.focus();
	}
}

async function handleChangePassword() {
	passwordError.value = null;
	passwordSuccess.value = false;
	if (passwordBusy.value) return;
	if (passwordForm.value.new_password.length < 8) {
		passwordError.value = t("admin.password.minLength");
		return;
	}
	if (passwordForm.value.new_password !== passwordForm.value.confirm) {
		passwordError.value = t("admin.password.mismatch");
		return;
	}
	passwordBusy.value = true;
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
			closePasswordModal();
		}, 1500);
	} catch (err) {
		passwordError.value = err instanceof Error ? err.message : t("admin.password.failed");
	} finally {
		passwordBusy.value = false;
	}
}

// Close mobile sidebar when route changes
watch(
	() => route.path,
	() => {
		sidebarOpen.value = false;
	},
);

// Navigation items matching the Next.js admin layout. The Users section
// (manage admins) is superuser-only — hidden for editors (DEC-054, TASK-116).
const navItems = computed(() => {
	const items = [
		{ href: "/admin", labelKey: "admin.nav.dashboard", icon: "lucide:layout-dashboard" },
		{ href: "/admin/posts", labelKey: "admin.nav.posts", icon: "lucide:file-text" },
		{ href: "/admin/calendar", labelKey: "admin.nav.calendar", icon: "lucide:calendar-days" },
		{ href: "/admin/comments", labelKey: "admin.nav.comments", icon: "lucide:message-circle" },
		{ href: "/admin/categories", labelKey: "admin.nav.categories", icon: "lucide:folder" },
		{ href: "/admin/tags", labelKey: "admin.nav.tags", icon: "lucide:tag" },
		{ href: "/admin/series", labelKey: "admin.nav.series", icon: "lucide:layers" },
		{ href: "/admin/settings", labelKey: "admin.nav.settings", icon: "lucide:settings" },
		{ href: "/admin/media", labelKey: "admin.nav.media", icon: "lucide:images" },
		// Reader accounts (DEC-194): a moderation surface, so available to every
		// admin role — unlike /admin/users provisioning (superuser-only).
		{ href: "/admin/readers", labelKey: "admin.nav.readers", icon: "lucide:user-check" },
	];
	if (currentRole.value === "superuser") {
		items.push({ href: "/admin/users", labelKey: "admin.nav.users", icon: "lucide:users" });
	}
	return items;
});
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900">
    <!-- Login page — no sidebar -->
    <div v-if="isLoginPage" class="min-h-screen flex items-center justify-center">
      <slot />
    </div>

    <!-- Authenticated layout — with sidebar -->
    <div
      v-else-if="isAuthenticated"
      class="flex min-h-screen"
    >
      <!-- Mobile overlay (Escape / focus handling lives in onSidebarKeydown). -->
      <div
        v-if="sidebarOpen"
        class="fixed inset-0 bg-black/50 z-40 lg:hidden"
        @click="closeMobileSidebar"
        aria-hidden="true"
      />

      <!-- Sidebar (mobile drawer focus + Tab trap via onSidebarKeydown) -->
      <aside
        ref="sidebarAsideRef"
        class="fixed lg:static inset-y-0 left-0 z-50 w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 min-h-screen transform transition-transform duration-200"
        :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'"
        @keydown="onSidebarKeydown"
      >
        <div class="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-xl font-bold text-gray-900 dark:text-gray-100">
            {{ t('admin.title') }}
          </h2>
          <button
            ref="sidebarCloseRef"
            type="button"
            class="lg:hidden p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            @click="closeMobileSidebar"
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

          <!-- Theme toggle (shared useTheme): the admin UI had no control and
               ignored the saved preference until this addition (deep-dive). -->
          <button
            type="button"
            class="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200 transition-all duration-200 w-full"
            @click="toggleTheme"
            :aria-label="isDark ? t('common.theme.toggleLight') : t('common.theme.toggleDark')"
          >
            <Icon :icon="isDark ? 'lucide:sun' : 'lucide:moon'" class="w-4 h-4" />
            {{ isDark ? t('common.theme.light') : t('common.theme.dark') }}
          </button>

          <!-- Comment-moderation alerts (DEC-080): opt this browser into a push
               when a new comment awaits approval. Admin-context only. -->
          <AdminPushToggle />

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
            :aria-expanded="sidebarOpen"
            :aria-label="t('common.menu.open')"
          >
            <Icon icon="lucide:menu" class="w-6 h-6" />
          </button>
          <span class="font-bold text-gray-900 dark:text-gray-100">{{ t('admin.title') }}</span>
          <button
            type="button"
            class="ml-auto p-2 -mr-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
            @click="toggleTheme"
            :aria-label="isDark ? t('common.theme.toggleLight') : t('common.theme.toggleDark')"
          >
            <Icon :icon="isDark ? 'lucide:sun' : 'lucide:moon'" class="w-5 h-5" />
          </button>
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-modal-title"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        @click.self="closePasswordModal"
        @keydown="onPasswordKeydown"
      >
        <div
          ref="passwordPanelRef"
          class="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm mx-4"
        >
          <button
            type="button"
            :aria-label="t('common.menu.close')"
            :title="t('common.menu.close')"
            class="absolute top-3 right-3 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            @click="closePasswordModal"
          >
            <Icon icon="lucide:x" class="w-4 h-4" />
          </button>
          <h3 id="password-modal-title" class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{{ t('admin.password.title') }}</h3>

          <div v-if="passwordSuccess" class="p-3 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-xl text-sm mb-4">
            {{ t('admin.password.success') }}
          </div>

          <form @submit.prevent="handleChangePassword" class="space-y-4">
            <div>
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">{{ t('admin.password.current') }}</label>
              <input
                ref="passwordCurrentInput"
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
              <button type="submit" :disabled="passwordBusy" class="flex-1 px-4 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors">
                {{ passwordBusy ? t('admin.password.saving') : t('common.action.save') }}
              </button>
              <button type="button" :disabled="passwordBusy" class="flex-1 px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors" @click="closePasswordModal">
                {{ t('common.action.cancel') }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
    <RateLimitNotice />
  </div>
</template>
