<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import { type Locale } from "~~/composables/i18n";
import { useLang } from "~~/composables/useLang";

const { locale, setLocale, locales } = useLang();

// Current language label shown on the trigger button.
const currentLabel = computed(
	() => locales.find((l) => l.code === locale.value)?.native ?? locale.value,
);

// Dropdown open state, closed by selecting, outside click, or Escape.
const open = ref(false);
const root = ref<HTMLElement | null>(null);

function onSelect(code: Locale) {
	setLocale(code);
	open.value = false;
}

function onDocPointer(e: Event) {
	if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}

function onKeydown(e: KeyboardEvent) {
	if (e.key === "Escape") open.value = false;
}

onMounted(() => {
	document.addEventListener("click", onDocPointer);
	document.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
	document.removeEventListener("click", onDocPointer);
	document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div ref="root" class="relative select-none">
    <button
      type="button"
      class="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      :aria-haspopup="true"
      :aria-expanded="open"
      :aria-label="currentLabel"
      @click="open = !open"
    >
      {{ currentLabel }}
      <Icon
        icon="lucide:chevron-down"
        class="w-3 h-3 transition-transform duration-200"
        :class="open ? 'rotate-180' : ''"
      />
    </button>

    <Transition name="lang-dropdown">
      <div
        v-if="open"
        role="menu"
        class="absolute right-0 mt-1.5 z-50 min-w-[120px] overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 py-1 shadow-lg"
      >
        <button
          v-for="l in locales"
          :key="l.code"
          type="button"
          role="menuitem"
          class="flex w-full items-center justify-between gap-3 whitespace-nowrap px-3 py-1.5 text-left text-xs font-medium transition-colors"
          :class="locale === l.code
            ? 'text-blue-600 dark:text-blue-400'
            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'"
          :aria-current="locale === l.code ? 'true' : undefined"
          @click="onSelect(l.code)"
        >
          {{ l.native }}
          <Icon v-if="locale === l.code" icon="lucide:check" class="h-3.5 w-3.5" />
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.lang-dropdown-enter-active,
.lang-dropdown-leave-active {
  transition: opacity 0.15s ease-out, transform 0.15s ease-out;
  transform-origin: top right;
}
.lang-dropdown-enter-from,
.lang-dropdown-leave-to {
  opacity: 0;
  transform: scale(0.95) translateY(-2px);
}
</style>
