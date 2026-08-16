<script setup lang="ts">
const route = useRoute();
const { t } = useLang();
const isHome = computed(() => route.path === "/");

const navLinks = [
	{ to: "/", labelKey: "common.nav.home", icon: "lucide:home" },
	{ to: "/about", labelKey: "common.nav.about", icon: "lucide:user" },
	{ to: "/categories", labelKey: "common.nav.categories", icon: "lucide:folder-open" },
	{ to: "/search", labelKey: "common.nav.search", icon: "lucide:search" },
];

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
      <div class="container mx-auto px-4 sm:px-6 lg:px-8">
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
              v-for="link in navLinks"
              :key="link.to"
              :to="link.to"
              class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200"
              :class="route.path === link.to
                ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'"
            >
              <Icon :icon="link.icon" class="w-4 h-4" />
              {{ t(link.labelKey) }}
            </NuxtLink>

            <!-- Instant search suggestions -->
            <HeaderSearch class="w-56 mx-2" />

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
            @click="mobileMenuOpen = !mobileMenuOpen"
          >
            <Icon :icon="mobileMenuOpen ? 'lucide:x' : 'lucide:menu'" class="w-5 h-5 transition-transform duration-200" />
          </button>
        </div>
      </div>

      <!-- Mobile navigation -->
      <Transition name="slide">
        <div v-if="mobileMenuOpen" class="md:hidden border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-950">
          <div class="container mx-auto px-4 py-4 space-y-1">
            <NuxtLink
              v-for="link in navLinks"
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
            </NuxtLink>
            <div class="px-4 py-2">
              <HeaderSearch />
            </div>
            <div class="px-4 py-2">
              <LanguageSwitcher />
            </div>
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
    <main class="flex-1 container mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-10">
      <slot />
    </main>

    <!-- Footer -->
    <footer class="border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
      <div class="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
