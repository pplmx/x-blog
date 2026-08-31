<script setup lang="ts">
import { useNotificationBadge } from "~~/composables/useNotificationBadge";
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

// Unread notification badge (DEC-160, TASK-192; ISS-124/TASK-224): a
// visibility-aware poll keeps the nav badge fresh for signed-in readers, and
// the /notifications inbox refreshes the same shared count after a mark-read
// action so the badge drops without a page reload. Polling follows auth state:
// signing in starts it, signing out stops it.
const { unreadCount, startPolling, stopPolling } = useNotificationBadge();
watch(isAuthenticated, (auth) => {
	if (auth) startPolling();
	else stopPolling();
});
onMounted(() => {
	if (isAuthenticated.value) startPolling();
});
onUnmounted(() => {
	stopPolling();
});

const isDark = ref(false);
const mobileMenuOpen = ref(false);
// The menu toggle itself: Escape/focus-restore (ISS-131, TASK-231) sends focus
// back here when the panel closes so keyboard users never lose their place.
const mobileMenuToggle = ref<HTMLButtonElement | null>(null);

function updateDarkClass() {
	if (typeof document === "undefined") return;
	document.documentElement.classList.toggle("dark", isDark.value);
}

function toggleDark() {
	isDark.value = !isDark.value;
}

// Keyboard semantics for the mobile nav (ISS-131): Escape closes and returns
// focus to the toggle; opening the panel moves focus to its first link so the
// next Tab/Enter starts inside the menu instead of re-walking the header.
function handleNavKeydown(e: KeyboardEvent) {
	// Respect a nested widget that already consumed Escape (e.g. HeaderSearch
	// closing its own suggestions): only close the whole menu when nothing
	// more-specific handled the key first.
	if (e.key !== "Escape" || !mobileMenuOpen.value || e.defaultPrevented) return;
	mobileMenuOpen.value = false;
	mobileMenuToggle.value?.focus();
}

function openMobileMenu() {
	mobileMenuOpen.value = true;
	nextTick(() => {
		document
			.querySelector<HTMLElement>("#mobile-nav a, #mobile-nav button")
			?.focus({ preventScroll: true });
	});
}

function toggleMobileMenu() {
	if (mobileMenuOpen.value) {
		mobileMenuOpen.value = false;
		// The click already leaves focus on the toggle; keep it there.
		mobileMenuToggle.value?.focus();
	} else {
		openMobileMenu();
	}
}

watch(
	() => route.path,
	() => {
		mobileMenuOpen.value = false;
	},
);

onMounted(() => {
	window.addEventListener("keydown", handleNavKeydown);
});
onUnmounted(() => {
	window.removeEventListener("keydown", handleNavKeydown);
});

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

          <!-- Desktop nav (xl+; ISS-125/TASK-225): the full link set + search +
               lang + theme + auth needs 1400px+ in English once the reader is
               signed in. Below xl the mobile menu takes over; at xl the ROW
               scrolls (scrollbar hidden) rather than clipping, and that scroll
               is confined to the LINKS+search group. The chrome controls
               (push subscribe, account, language, theme) sit OUTSIDE the scroll
               container as fixed, always-visible siblings — so even a Firefox
               wheel user (which doesn't map a vertical wheel to overflow-x
               panning) always reaches sign-out/language/theme without relying
               on horizontal scroll. The links group right-aligns via `margin-
               left:auto` on its first item (NOT `justify-end`): flex-end
               +overflow clips the left-most items (scrollLeft can't go
               negative), whereas the auto margin collapses to 0 on overflow so
               the group scrolls from its start. No nav item is ever
               unreachable at any width/locale/auth state. -->
          <div class="hidden xl:flex flex-1 min-w-0 items-center justify-end gap-1">
            <nav class="flex items-center gap-1 overflow-x-auto min-w-0">
              <NuxtLink
                v-for="link in navLinksVisible"
                :key="link.to"
                :to="link.to"
                class="first:ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2 py-2 rounded-lg text-sm font-medium transition-all duration-200"
                :class="route.path === link.to
                  ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'"
              >
                <Icon :icon="link.icon" class="w-4 h-4" />
                {{ t(link.labelKey) }}
                <span
                  v-if="link.badge && unreadCount > 0"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                  class="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full text-[11px] font-bold bg-amber-500 text-white"
                >{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
              </NuxtLink>

              <!-- Instant search suggestions -->
              <HeaderSearch class="w-44 mx-2" />
            </nav>

            <!-- Web Push opt-in (new-post notifications) -->
            <SubscribeButton class="mx-1 shrink-0" compact />

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
            <LanguageSwitcher class="mx-2 shrink-0" />

            <!-- Dark mode toggle -->
            <div class="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-2 shrink-0" />

            <button
              type="button"
              :aria-label="isDark ? t('common.theme.toggleLight') : t('common.theme.toggleDark')"
              class="shrink-0 p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200 transition-all duration-200"
              @click="toggleDark"
            >
              <Icon v-if="isDark" icon="lucide:sun" class="w-4 h-4" />
              <Icon v-else icon="lucide:moon" class="w-4 h-4" />
            </button>
          </div>

          <!-- Mobile menu button (xl below: the desktop nav can't fit before
               ~1150px, so tablets/compact laptops use the menu instead) -->
          <button
            ref="mobileMenuToggle"
            type="button"
            class="xl:hidden p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            :aria-label="t('common.menu.open')"
            :aria-expanded="mobileMenuOpen"
            aria-controls="mobile-nav"
            @click="toggleMobileMenu"
          >
            <Icon :icon="mobileMenuOpen ? 'lucide:x' : 'lucide:menu'" class="w-5 h-5 transition-transform duration-200" />
          </button>
        </div>
      </div>

      <!-- Mobile navigation -->
      <Transition name="slide">
        <div v-if="mobileMenuOpen" id="mobile-nav" class="xl:hidden border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-950">
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
                role="status"
                aria-live="polite"
                aria-atomic="true"
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

<style scoped>
/* The desktop nav scrolls internally when the full link set outgrows the
   viewport (English + signed-in at 1280–1536px). Hide the scrollbar so the
   header stays chrome-clean; the nav still scrolls via wheel/trackpad, and
   the mobile menu below xl covers every case without scrolling. (ISS-125) */
nav {
	scrollbar-width: none;
	-ms-overflow-style: none;
}
nav::-webkit-scrollbar {
	display: none;
}
</style>
