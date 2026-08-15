<script setup lang="ts">
import type { Bookmark } from "~~/composables/useBookmarks";
import { useBookmarks } from "~~/composables/useBookmarks";

interface Props {
	postId: number;
	post?: Bookmark;
	variant?: "icon" | "full";
}

type Emits = (e: "toggle", postId: number) => void;

const props = withDefaults(defineProps<Props>(), {
	variant: "icon",
});

const emit = defineEmits<Emits>();

const { t } = useLang();
const { isBookmarked, toggleBookmark } = useBookmarks();

function handleClick() {
	if (props.post) {
		toggleBookmark(props.post);
	}
	emit("toggle", props.postId);
}
</script>

<template>
  <button
    type="button"
    @click.stop="handleClick"
    :title="isBookmarked(postId) ? t('components.bookmark.remove') : t('components.bookmark.article')"
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
