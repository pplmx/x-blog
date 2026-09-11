<script setup lang="ts">
import { syncIssue, useBookmarkSync } from "~~/composables/useBookmarkSync";
import type { Bookmark } from "~~/composables/useBookmarks";

interface Props {
	postId: number;
	post?: Bookmark;
	variant?: "icon" | "full";
	/** Disabled while the surrounding page is mid-SPA-refetch: a bookmark click
	 * during the prev/next window would target the OLD post the reader is still
	 * looking at. (ISS-416, article-page deep-dive) */
	disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
	variant: "icon",
	disabled: false,
});

const { t } = useLang();
const { isBookmarked, add, remove } = useBookmarkSync();

/** Per-post in-flight guard: `add`/`remove` mutate the local list
 * synchronously, so the second half of a fast double-click would read the
 * just-changed state and immediately reverse the toggle — the icon blinks on
 * then off and the post ends up unsaved. Swallow clicks for a short window
 * after each toggle (like CommentList's likingIds guard), then let a
 * deliberate later click through. */
let togglingId: number | null = null;
let togglingTimer: ReturnType<typeof setTimeout> | null = null;

function handleClick() {
	// Double guard: the button is also `:disabled`, but an Enter-pressed button
	// still fires click in some browsers; keep the handler a no-op while disabled.
	if (props.disabled) return;
	if (!props.post) return;
	if (togglingId === props.postId) return;
	if (togglingTimer) clearTimeout(togglingTimer);
	togglingId = props.postId;
	togglingTimer = setTimeout(() => {
		togglingId = null;
	}, 200);
	// Mirror to the cloud when signed in (TASK-134); local remains the
	// single source of truth for the button state.
	if (isBookmarked(props.postId)) {
		remove(props.postId);
	} else {
		add(props.post);
	}
}

// When the stored session is dead (syncIssue === "auth", ISS-222) the toggle
// works locally but the cloud silently rejects the mirror. Tell the reader on
// the button itself, not just later on /bookmarks — the icon stays truthful
// (the local bookmark IS saved), so only the hint text changes.
const label = computed(() => {
	if (syncIssue.value === "auth") return t("components.bookmark.sessionExpired");
	return isBookmarked(props.postId)
		? t("components.bookmark.remove")
		: t("components.bookmark.article");
});
</script>

<template>
  <button
    type="button"
    @click.stop="handleClick"
    :title="label"
    :aria-pressed="isBookmarked(postId) ? 'true' : 'false'"
    :aria-label="label"
    :disabled="disabled"
    :class="[
      'inline-flex items-center justify-center rounded-xl transition-all duration-200',
      'disabled:opacity-60 disabled:cursor-not-allowed',
      variant === 'icon'
        ? 'w-9 h-9 p-0 hover:bg-gray-100 dark:hover:bg-gray-800'
        : 'gap-2 px-3 py-1.5 text-sm',
      isBookmarked(postId)
        ? 'text-blue-600 dark:text-blue-400'
        : 'text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400',
    ]"
  >
    <Icon
      :icon="isBookmarked(postId) ? 'lucide:bookmark-check' : 'lucide:bookmark'"
      :class="variant === 'full' ? 'w-4 h-4' : 'w-5 h-5'"
    />
    <span v-if="variant === 'full'" class="hidden sm:inline">
      {{ isBookmarked(postId) ? t('components.bookmark.added') : t('components.bookmark.add') }}
    </span>
  </button>
</template>
