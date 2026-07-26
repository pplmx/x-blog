<template>
  <div class="min-h-screen flex flex-col">
    <header class="sticky top-0 z-50 border-b border-gray-100 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md">
      <div class="container mx-auto px-4 py-4 flex justify-between items-center">
        <NuxtLink
          to="/"
          class="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent hover:from-blue-700 hover:to-indigo-700 transition-all"
        >
          X-Blog
        </NuxtLink>

        <!-- Desktop navigation -->
        <div class="hidden md:flex items-center gap-4">
          <nav aria-label="主导航">
            <ul class="flex gap-5 list-none m-0 p-0">
              <li>
                <NuxtLink
                  to="/"
                  class="flex items-center gap-1.5 text-gray-600 hover:text-blue-600 transition-colors"
                >
                  <Icon icon="lucide:home" class="w-4 h-4" aria-hidden="true" />
                  <span>首页</span>
                </NuxtLink>
              </li>
              <li>
                <NuxtLink
                  to="/about"
                  class="flex items-center gap-1.5 text-gray-600 hover:text-blue-600 transition-colors"
                >
                  <Icon icon="lucide:user" class="w-4 h-4" aria-hidden="true" />
                  <span>关于</span>
                </NuxtLink>
              </li>
            </ul>
          </nav>

          <!-- Dark mode toggle -->
          <button
            type="button"
            @click="toggleDark"
            :aria-label="isDark ? '切换到浅色模式' : '切换到深色模式'"
            class="p-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            <Icon
              :icon="isDark ? 'lucide:sun' : 'lucide:moon'"
              class="w-4 h-4"
            />
          </button>
        </div>
      </div>
    </header>

    <main class="container mx-auto px-4 py-8 flex-1">
      <slot />
    </main>

    <footer class="border-t border-gray-100 dark:border-gray-800 py-6 mt-auto">
      <div class="container mx-auto px-4 text-center text-sm text-gray-500 dark:text-gray-400">
        Made with <Icon icon="lucide:heart" class="w-4 h-4 text-red-500 animate-pulse" /> for developers
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";

// Default layout - no props needed

// Dark mode toggle
const isDark = ref(false);

function updateDarkClass() {
	if (typeof document === "undefined") return;
	document.documentElement.classList.toggle("dark", isDark.value);
}

function toggleDark() {
	isDark.value = !isDark.value;
}

onMounted(() => {
	try {
		// Check for saved preference or system preference
		const saved = localStorage.getItem("theme");
		if (saved === "dark") {
			isDark.value = true;
		} else if (saved === "light") {
			isDark.value = false;
		} else if (window.matchMedia) {
			isDark.value = window.matchMedia("(prefers-color-scheme: dark)").matches;
		}
		updateDarkClass();

		// Save preference to localStorage when it changes
		watch(isDark, (newVal) => {
			updateDarkClass();
			localStorage.setItem("theme", newVal ? "dark" : "light");
		});
	} catch {
		// localStorage or matchMedia not available (e.g., in test env)
		isDark.value = false;
		updateDarkClass();
	}
});
</script>
