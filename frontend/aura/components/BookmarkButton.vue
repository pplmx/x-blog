<script setup lang="ts">
import { syncIssue, useBookmarkSync } from "~~/composables/useBookmarkSync";
import type { Bookmark } from "~~/composables/useBookmarks";

interface Props {
	postId: number;
	post?: Bookmark;
	variant?: "icon" | "full";
}

const props = withDefaults(defineProps<Props>(), {
	variant: "icon",
});

const { t } = useLang();
const { isBookmarked, add, remove } = useBookmarkSync();

function handleClick() {
	if (props.post) {
		// Mirror to the cloud when signed in (TASK-134); local remains the
		// single source of truth for the button state.
		if (isBookmarked(props.postId)) {
			remove(props.postId);
		} else {
			add(props.post);
		}
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
    :class="[
      'inline-flex items-center justify-center rounded-xl transition-all duration-200',
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
