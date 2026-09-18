<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";

import { useLang } from "~~/composables/useLang";
import { useNotificationBadge } from "~~/composables/useNotificationBadge";
import { useReaderAuth } from "~~/composables/useReaderAuth";
import { nextFocusable } from "~~/utils/focusRing";

/** Reader-personal entry, shared with the mobile "我的" group in default.vue. */
interface MyLink {
	to: string;
	labelKey: string;
	icon: string;
	/** Marker (e.g. "unread") for rows that render the notification badge. */
	badge?: string;
}

const props = defineProps<{
	links: MyLink[];
}>();

const { t } = useLang();
// Auth guarantees the reader is signed in — default.vue only mounts this
// component when isAuthenticated (the trailing auth-gated node). `reader` is
// the localStorage-persisted profile, so the avatar/name render with zero
// extra requests.
const { reader, logout } = useReaderAuth();
// Shared badge singleton (same ref the layout polls); guests never mount us.
const { unreadCount } = useNotificationBadge();

// Mini profile header shows the display name, falling back to the email, or the
// letter avatar's "R" when neither exists yet (mirrors the /account page).
const displayName = computed(() => reader.value?.display_name ?? reader.value?.email ?? "");

// Dropdown state — same outside-click/Escape/Tab contract as LanguageSwitcher.
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);

const ROVING_KEYS = ["ArrowDown", "ArrowUp", "Home", "End"];

const menuItems = () =>
	Array.from(root.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

// Closing removes the focused menuitem from the DOM — return focus to the
// trigger so a keyboard/SR user keeps their place in the nav (ISS/MENU a11y).
function closeMenu() {
	open.value = false;
	trigger.value?.focus({ preventScroll: true });
}

function toggle() {
	if (open.value) {
		closeMenu();
		return;
	}
	open.value = true;
	// ARIA menu pattern: focus moves into the list on open, onto the first item.
	nextTick(() => {
		menuItems()[0]?.focus({ preventScroll: true });
	});
}

function onDocPointer(e: Event) {
	if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}

// Full menu keyboard contract: Escape closes (focus back to trigger);
// ArrowDown/ArrowUp/Home/End roam between the items; Tab hands focus to the
// next control after the trigger (see LanguageSwitcher's round-300 comment).
function onKeydown(e: KeyboardEvent) {
	if (e.key === "Escape") {
		if (open.value) closeMenu();
		return;
	}
	if (!open.value) return;
	if (e.key === "Tab") {
		e.preventDefault();
		open.value = false;
		const popover = root.value?.querySelector<HTMLElement>('[role="menu"]') ?? null;
		nextTick(() => {
			nextFocusable(trigger.value, { exclude: popover, shift: e.shiftKey })?.focus({
				preventScroll: true,
			});
		});
		return;
	}
	if (!ROVING_KEYS.includes(e.key)) return;
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

function onSignOut() {
	closeMenu();
	logout();
}
</script>

<template>
  <div ref="root" class="relative shrink-0">
    <button
      ref="trigger"
      type="button"
      class="inline-flex shrink-0 items-center rounded-lg p-1 text-gray-600 transition-colors duration-200 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
      :aria-label="t('reader.nav.groupMy')"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="toggle"
    >
      <!-- Avatar (DEC-299) or letter fallback, + unread badge (ISS-124). -->
      <span class="relative">
        <img
          v-if="reader?.avatar_url"
          :src="reader.avatar_url"
          :alt="displayName ? `avatar of ${displayName}` : 'avatar'"
          class="h-8 w-8 rounded-full object-cover"
        />
        <span
          v-else
          class="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-purple-600 text-sm font-semibold text-white"
        >
          {{ (displayName || "R").charAt(0).toUpperCase() }}
        </span>
        <span
          v-if="unreadCount > 0"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          class="absolute -right-1 -top-1 inline-flex min-w-[1.15rem] items-center justify-center rounded-full border-2 border-white bg-amber-500 px-1 text-[10px] font-bold leading-4 text-white dark:border-gray-950"
        >{{ unreadCount > 99 ? "99+" : unreadCount }}</span>
      </span>
      <Icon
        icon="lucide:chevron-down"
        class="ml-0.5 h-3.5 w-3.5 transition-transform duration-200"
        :class="open ? 'rotate-180' : ''"
      />
    </button>

    <Transition name="my-dropdown">
      <div
        v-if="open"
        role="menu"
        class="absolute right-0 z-50 mt-1.5 w-60 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
      >
        <!-- Mini profile header → account settings. -->
        <NuxtLink
          to="/account"
          role="menuitem"
          class="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
          @click="closeMenu"
        >
          <img
            v-if="reader?.avatar_url"
            :src="reader.avatar_url"
            :alt="displayName ? `avatar of ${displayName}` : 'avatar'"
            class="h-9 w-9 rounded-full object-cover"
          />
          <span
            v-else
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-purple-600 text-sm font-semibold text-white"
          >
            {{ (displayName || "R").charAt(0).toUpperCase() }}
          </span>
          <span class="min-w-0">
            <span class="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
              {{ displayName }}
            </span>
            <span v-if="reader?.display_name" class="block truncate text-xs text-gray-400">
              {{ reader.email }}
            </span>
          </span>
        </NuxtLink>

        <!-- Public reader profile (round 352): their /readers/{id} page. -->
        <NuxtLink
          v-if="reader?.id"
          :to="`/readers/${reader.id}`"
          role="menuitem"
          class="flex items-center gap-3 px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          @click="closeMenu"
        >
          <Icon icon="lucide:user-round" class="h-4 w-4" />
          {{ t('reader.nav.viewMyProfile') }}
        </NuxtLink>

        <div class="my-1 h-px bg-gray-100 dark:bg-gray-800" />

        <NuxtLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          role="menuitem"
          class="flex items-center gap-3 px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          @click="closeMenu"
        >
          <Icon :icon="link.icon" class="h-4 w-4" />
          <span class="flex-1">{{ t(link.labelKey) }}</span>
          <span
            v-if="link.badge && unreadCount > 0"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            class="inline-flex min-w-[1.15rem] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold leading-4 text-white"
          >{{ unreadCount > 99 ? "99+" : unreadCount }}</span>
        </NuxtLink>

        <div class="my-1 h-px bg-gray-100 dark:bg-gray-800" />

        <button
          type="button"
          role="menuitem"
          class="flex w-full items-center gap-3 px-3 py-2 text-left text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          @click="onSignOut"
        >
          <Icon icon="lucide:log-out" class="h-4 w-4" />
          {{ t('reader.nav.signOut') }}
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.my-dropdown-enter-active,
.my-dropdown-leave-active {
	transition: opacity 0.15s ease-out, transform 0.15s ease-out;
	transform-origin: top right;
}
.my-dropdown-enter-from,
.my-dropdown-leave-to {
	opacity: 0;
	transform: scale(0.95) translateY(-2px);
}
</style>
