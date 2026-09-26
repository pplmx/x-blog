<script setup lang="ts">
/**
 * Reader profile picture with graceful degradation (round-446 polish).
 *
 * The img-if-set-else-initial-letter pattern was copy-pasted across the header
 * menu, comment list, /account and the reader profile page. This consolidates
 * it AND closes a gap the copies share: an avatar whose file vanished from the
 * server (out-of-band deletion, restore of a DB snapshot without the static
 * dir) rendered a broken-image icon — the letter placeholder replaces it on
 * @error, so the identity block never degrades to a broken glyph.
 */
import { computed, ref } from "vue";

const props = withDefaults(
	defineProps<{
		/** Absolute /static/avatars/... URL, or null → letter placeholder. */
		url?: string | null;
		/** Name used for alt text and the initial letter. */
		name?: string | null;
		/** Alert/text label; empty for decorative avatars. */
		alt?: string;
		/** Tailwind size classes; defaults to the comment-row 5x5. */
		size?: string;
		/** Extra classes for the letter glyph (tune text size on large avatars). */
		glyph?: string;
	}>(),
	{
		url: null,
		name: null,
		alt: "",
		size: "w-5 h-5",
		glyph: "",
	},
);

// Whether the <img> failed to load (file gone, network blip). Once true the
// img is hidden and the letter placeholder shows instead — a broken image
// icon is worse than no image.
const failed = ref(false);

const initial = computed(() => (props.name || "R").charAt(0).toUpperCase());
</script>

<template>
	<img
		v-if="props.url && !failed"
		:src="props.url"
		:alt="alt || ''"
		class="shrink-0 rounded-full object-cover"
		:class="size"
		@error="failed = true"
	/>
	<span
		v-else
		class="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white font-bold"
		:class="[size, glyph]"
		aria-hidden="true"
	>
		{{ initial }}
	</span>
</template>
