<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";

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
const trigger = ref<HTMLButtonElement | null>(null);

const menuItems = () =>
	Array.from(root.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

// Closing removes the focused menuitem from the DOM — return focus to the
// trigger so a keyboard/SR user keeps their place in the nav instead of
// landing on <body> (ISS/MENU a11y class).
function closeMenu() {
	open.value = false;
	trigger.value?.focus({ preventScroll: true });
}

function onSelect(code: Locale) {
	setLocale(code);
	closeMenu();
}

function toggle() {
	if (open.value) {
		closeMenu();
		return;
	}
	open.value = true;
	// ARIA menu pattern: focus moves into the list on open, onto the current
	// locale's item (falling back to the first).
	nextTick(() => {
		const items = menuItems();
		const current = locales.findIndex((l) => l.code === locale.value);
		(items[Math.max(0, current)] ?? items[0])?.focus({ preventScroll: true });
	});
}

function onDocPointer(e: Event) {
	if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}

// Full menu keyboard contract: Escape closes (focus back to trigger);
// ArrowDown/ArrowUp/Home/End move focus between the locale items.
function onKeydown(e: KeyboardEvent) {
	if (e.key === "Escape") {
		if (open.value) closeMenu();
		return;
	}
	if (!open.value) return;
	const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
	if (!keys.includes(e.key)) return;
	const items = menuItems();
	if (items.length === 0) return;
	e.preventDefault();
	const active = document.activeElement as HTMLElement | null;
	const idx = active ? items.indexOf(active) : -1;
	let next: number;
	if (e.key === "Home") next = 0;
	else if (e.key === "End") next = items.length - 1;
	else if (e.key === "ArrowDown") next = idx < 0 ? 0 : (idx + 1) % items.length;
	else next = idx <= 0 ? items.length - 1 : idx - 1;
	items[next]?.focus();
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
      ref="trigger"
      type="button"
      class="flex w-24 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-label="currentLabel"
      @click="toggle"
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
        class="absolute right-0 mt-1.5 z-50 w-36 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 py-1 shadow-lg"
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
