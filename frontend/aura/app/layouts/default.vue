<script setup lang="ts">
import { getReaderNotifications } from "~~/api/reader/notifications";
import { useReaderAuth } from "~~/composables/useReaderAuth";

const route = useRoute();
const { t } = useLang();
const isHome = computed(() => route.path === "/");
const { isAuthenticated, logout } = useReaderAuth();

const navLinks = [
	{ to: "/", labelKey: "common.nav.home", icon: "lucide:home" },
	{ to: "/about", labelKey: "common.nav.about", icon: "lucide:user" },
	{ to: "/categories", labelKey: "common.nav.categories", icon: "lucide:folder-open" },
	{ to: "/series", labelKey: "common.nav.series", icon: "lucide:layers" },
	{ to: "/archive", labelKey: "common.nav.archive", icon: "lucide:archive" },
	{ to: "/search", labelKey: "common.nav.search", icon: "lucide:search" },
	{ to: "/bookmarks", labelKey: "reader.nav.bookmarks", icon: "lucide:bookmark" },
	{ to: "/history", labelKey: "reader.nav.history", icon: "lucide:history" },
	{ to: "/comments", labelKey: "reader.nav.comments", icon: "lucide:message-square" },
	{
		to: "/notifications",
		labelKey: "reader.nav.notifications",
		icon: "lucide:bell",
		authOnly: true,
		badge: "unread",
	},
	{ to: "/account", labelKey: "reader.nav.account", icon: "lucide:settings", authOnly: true },
];
const navLinksVisible = computed(() =>
	navLinks.filter((l) => !l.authOnly || isAuthenticated.value),
);

// Unread notification badge (DEC-160, TASK-192): polled for signed-in readers
// so the nav reflects new notifications without a page reload.
const unreadCount = ref(0);
async function refreshUnread() {
	if (!isAuthenticated.value) {
		unreadCount.value = 0;
		return;
	}
	try {
		const data = await getReaderNotifications(1, 1);
		unreadCount.value = data.unread;
	} catch {
		unreadCount.value = 0;
	}
}
onMounted(() => {
	if (isAuthenticated.value) void refreshUnread();
});

const isDark = ref(false);
const mobileMenuOpen = ref(false);

function updateDarkClass() {
	if (typeof document === "undefined") return;
	document.documentElement.classList.toggle("dark", isDark.value);
}

function toggleDark() {
	isDark.value = !isDark.value;
}

watch(
	() => route.path,
	() => {
		mobileMenuOpen.value = false;
	},
);

onMounted(() => {
	try {
		const saved = localStorage.getItem("theme");
		if (saved === "dark") isDark.value = true;
		else if (saved === "light") isDark.value = false;
		else if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) isDark.value = true;
		updateDarkClass();
		watch(isDark, (v) => {
			updateDarkClass();
			localStorage.setItem("theme", v ? "dark" : "light");
		});
	} catch {
		isDark.value = false;
		updateDarkClass();
	}
});
</script>

<template>
  <div class="min-h-screen flex flex-col bg-white dark:bg-gray-950 transition-colors duration-300">
    <!-- Header -->
    <header
      class="sticky top-0 z-50 border-b border-gray-100/80 dark:border-gray-800/80"
      :class="isHome ? 'bg-white/70 dark:bg-gray-950/70 backdrop-blur-xl' : 'bg-white/90 dark:bg-gray-950/90 backdrop-blur-md'"
    >
      <div class="page-shell px-4 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between h-16">
          <!-- Logo -->
          <NuxtLink
            to="/"
            class="text-xl font-bold bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent hover:from-blue-500 hover:via-indigo-500 hover:to-purple-500 transition-all duration-300"
          >
            X-Blog
          </NuxtLink>

          <!-- Desktop nav -->
          <nav class="hidden md:flex items-center gap-1">
            <NuxtLink
              v-for="link in navLinksVisible"
              :key="link.to"
              :to="link.to"
              class="flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200"
              :class="route.path === link.to
                ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'"
            >
              <Icon :icon="link.icon" class="w-4 h-4" />
              {{ t(link.labelKey) }}
              <span
                v-if="link.badge && unreadCount > 0"
                class="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full text-[11px] font-bold bg-amber-500 text-white"
              >{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
            </NuxtLink>

            <!-- Instant search suggestions -->
            <HeaderSearch class="w-56 mx-2" />

            <!-- Web Push opt-in (new-post notifications) -->
            <SubscribeButton class="mx-1" />

            <!-- Reader account: sign in (→ /login) / sign out (TASK-133) -->
            <NuxtLink
              v-if="!isAuthenticated"
              to="/login"
              class="shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-200"
            >
              <Icon icon="lucide:log-in" class="w-4 h-4" />
              {{ t('reader.nav.signIn') }}
            </NuxtLink>
            <button
              v-else
              type="button"
              class="shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-200"
              @click="logout"
            >
              <Icon icon="lucide:log-out" class="w-4 h-4" />
              {{ t('reader.nav.signOut') }}
            </button>

            <!-- Language switcher -->
            <LanguageSwitcher class="mx-2" />

            <!-- Dark mode toggle -->
            <div class="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-2" />

            <button
              type="button"
              :aria-label="isDark ? t('common.theme.toggleLight') : t('common.theme.toggleDark')"
              class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200 transition-all duration-200"
              @click="toggleDark"
            >
              <Icon v-if="isDark" icon="lucide:sun" class="w-4 h-4" />
              <Icon v-else icon="lucide:moon" class="w-4 h-4" />
            </button>
          </nav>

          <!-- Mobile menu button -->
          <button
            type="button"
            class="md:hidden p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            :aria-label="t('common.menu.open')"
            :aria-expanded="mobileMenuOpen"
            aria-controls="mobile-nav"
            @click="mobileMenuOpen = !mobileMenuOpen"
          >
            <Icon :icon="mobileMenuOpen ? 'lucide:x' : 'lucide:menu'" class="w-5 h-5 transition-transform duration-200" />
          </button>
        </div>
      </div>

      <!-- Mobile navigation -->
      <Transition name="slide">
        <div v-if="mobileMenuOpen" id="mobile-nav" class="md:hidden border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-950">
          <div class="page-shell px-4 py-4 space-y-1">
            <NuxtLink
              v-for="link in navLinksVisible"
              :key="link.to"
              :to="link.to"
              class="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200"
              :class="route.path === link.to
                ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'"
              @click="mobileMenuOpen = false"
            >
              <Icon :icon="link.icon" class="w-4 h-4" />
              {{ t(link.labelKey) }}
              <span
                v-if="link.badge && unreadCount > 0"
                class="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full text-[11px] font-bold bg-amber-500 text-white"
              >{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
            </NuxtLink>
            <div class="px-4 py-2">
              <HeaderSearch />
            </div>
            <div class="px-4 py-2">
              <LanguageSwitcher />
            </div>
            <div class="px-4 py-2">
              <SubscribeButton />
            </div>
            <NuxtLink
              v-if="!isAuthenticated"
              to="/login"
              class="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              @click="mobileMenuOpen = false"
            >
              <Icon icon="lucide:log-in" class="w-4 h-4" />
              {{ t('reader.nav.signIn') }}
            </NuxtLink>
            <button
              v-else
              type="button"
              class="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              @click="logout"
            >
              <Icon icon="lucide:log-out" class="w-4 h-4" />
              {{ t('reader.nav.signOut') }}
            </button>
            <button
              type="button"
              class="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              @click="toggleDark"
            >
              <Icon :icon="isDark ? 'lucide:sun' : 'lucide:moon'" class="w-4 h-4" />
              {{ isDark ? t('common.theme.light') : t('common.theme.dark') }}
            </button>
          </div>
        </div>
      </Transition>
    </header>

    <!-- Main -->
    <main class="flex-1 page-shell px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-10">
      <slot />
    </main>

    <!-- Footer -->
    <footer class="border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
      <div class="page-shell px-4 sm:px-6 lg:px-8 py-8">
        <div class="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <span>© 2026 X-Blog.</span>
            <span>{{ t('common.footer.madeWith') }}</span>
            <Icon icon="lucide:heart" class="w-3.5 h-3.5 text-red-500 fill-red-500" />
            <span>{{ t('common.footer.forDevelopers') }}</span>
          </div>
          <div class="flex items-center gap-4 text-sm text-gray-400 dark:text-gray-500">
            <NuxtLink to="/" class="hover:text-gray-600 dark:hover:text-gray-300 transition-colors">{{ t('common.nav.home') }}</NuxtLink>
            <NuxtLink to="/about" class="hover:text-gray-600 dark:hover:text-gray-300 transition-colors">{{ t('common.nav.about') }}</NuxtLink>
            <a
              href="/rss/feed.xml"
              type="application/rss+xml"
              class="hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              :title="t('common.footer.subscribeRss')"
            >
              <span class="inline-flex items-center gap-1.5">
                <Icon icon="lucide:rss" class="w-4 h-4" />
                {{ t('common.footer.subscribeRss') }}
              </span>
            </a>
            <a href="https://github.com/pplmx/x-blog" target="_blank" rel="noopener noreferrer" class="hover:text-gray-600 dark:hover:text-gray-300 transition-colors">GitHub</a>
          </div>
        </div>
      </div>
    </footer>
  </div>
</template>
