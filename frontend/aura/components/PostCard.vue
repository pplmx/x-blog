<script setup lang="ts">
import type { PostList } from "~~/composables/useApi";

interface Props {
	post: PostList;
}

const props = withDefaults(defineProps<Props>(), {});
const { post } = toRefs(props);

/**
 * Generate algorithmic cover image SVG data URL — no HTTP request needed.
 * Uses title hash to dynamically compute HSL colors for infinite variety.
 */

/** Convert HSL to hex color. All args in degrees/percentages. */
function hslToHex(h: number, s: number, l: number): string {
	h = ((h % 360) + 360) % 360;
	s = Math.max(0, Math.min(100, s)) / 100;
	l = Math.max(0, Math.min(100, l)) / 100;
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;
	const [r, g, b] =
		h < 60 ? [c, x, 0] :
		h < 120 ? [x, c, 0] :
		h < 180 ? [0, c, x] :
		h < 240 ? [0, x, c] :
		h < 300 ? [x, 0, c] :
		[c, 0, x];
	return `#${Math.round((r + m) * 255).toString(16).padStart(2, "0")}${Math.round((g + m) * 255).toString(16).padStart(2, "0")}${Math.round((b + m) * 255).toString(16).padStart(2, "0")}`;
}

/**
 * Dynamically generate a gradient color scheme from a title hash.
 * Uses the golden ratio to distribute hues aesthetically, with
 * varying saturation and lightness for depth and variety.
 */
function generateColorScheme(title: string): { start: string; end: string } {
	// Multi-part hash: use different bits for hue, saturation, lightness
	let hash = 0;
	for (const char of title) {
		hash = (hash * 31 + char.charCodeAt(0)) | 0;
	}
	const h = Math.abs(hash);

	// Golden ratio — distributes hues evenly across the color wheel
	const goldenRatio = 0.618033988749895;
	const baseHue = (h % 360 + 360) % 360;
	const endHue = ((baseHue + goldenRatio * 360) % 360 + 360) % 360;

	// Vary saturation (70-95%) and lightness (35-60%) for depth
	const baseSat = 70 + (h % 26);
	const endSat = 70 + ((h >> 5) % 26);
	const baseLight = 35 + (h % 26);
	const endLight = 40 + ((h >> 5) % 21);

	return {
		start: hslToHex(baseHue, baseSat, baseLight),
		end: hslToHex(endHue, endSat, endLight),
	};
}

/**
 * Generate algorithmic cover image SVG data URL — no HTTP request needed.
 * Uses title hash to dynamically compute HSL colors for infinite variety.
 */
function coverImageSrc(title: string, coverImage?: string): string {
	if (coverImage) return coverImage;

	const colors = generateColorScheme(title);
	const shortTitle = title.length > 28 ? title.slice(0, 28) + "..." : title;

	// Build SVG string and encode once with encodeURIComponent — no HTTP request
	const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${colors.start}"/>
      <stop offset="100%" stop-color="${colors.end}"/>
    </linearGradient>
  </defs>
  <rect width="800" height="450" fill="url(#g)"/>
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="36" font-weight="700" font-family="Noto Sans SC, -apple-system, BlinkMacSystemFont, sans-serif" textLength="700" lengthAdjust="spacing_andGlyphs">
    ${shortTitle}
  </text>
</svg>`.trim();

	return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

const coverImageUrl = computed(() =>
	coverImageSrc(post.value.title, post.value.cover_image)
);

// Default placeholder gradient based on post title hash (fallback)
function getGradientFromTitle(title: string): string {
	const gradients = [
		"from-blue-500 to-indigo-600",
		"from-emerald-500 to-teal-600",
		"from-orange-500 to-red-600",
		"from-purple-500 to-pink-600",
		"from-cyan-500 to-blue-600",
	];
	const hash = title.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
	return gradients[hash % gradients.length];
}

const date = computed(() =>
	new Date(props.post.created_at).toLocaleDateString("zh-CN", {
		year: "numeric",
		month: "long",
		day: "numeric",
	}),
);
</script>

<template>
  <article class="group border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden hover:border-gray-200 dark:hover:border-gray-700 hover:shadow-xl hover:shadow-gray-100/50 dark:hover:shadow-gray-900/50 transition-all duration-300 bg-white dark:bg-gray-900 relative">
    <div class="absolute top-3 right-3 z-10">
      <BookmarkButton
        :post-id="post.id"
        :post="post"
        variant="icon"
      />
    </div>
    <NuxtLink :to="`/posts/${post.slug}`">
      <!-- Cover Image -->
      <div v-if="coverImageUrl" class="relative h-48 w-full overflow-hidden">
        <img
          :src="coverImageUrl"
          :alt="post.title"
          class="object-cover w-full h-full group-hover:scale-105 transition-transform duration-500"
        >
      </div>
      <div v-else :class="`h-32 bg-gradient-to-br ${getGradientFromTitle(post.title)} opacity-80`">
        <div class="w-full h-full flex items-center justify-center">
          <span class="text-4xl font-bold text-white/30">
            {{ post.title.charAt(0).toUpperCase() }}
          </span>
        </div>
      </div>

      <div class="p-6">
        <div class="flex items-start justify-between gap-4 mb-3">
          <h2 class="text-xl font-bold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 transition-colors duration-200 line-clamp-2">
            {{ post.title }}
          </h2>
          <Icon icon="lucide:arrow-right" class="w-5 h-5 text-gray-300 group-hover:text-blue-600 group-hover:translate-x-1 transition-all duration-300 shrink-0" />
        </div>

        <div class="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400 mb-4">
          <span class="flex items-center gap-1">
            <Icon icon="lucide:calendar" class="w-4 h-4" />
            {{ date }}
          </span>
          <span
            v-if="post.category"
            class="px-3 py-1 bg-gradient-to-r from-gray-50 dark:from-gray-800 to-gray-100 dark:to-gray-700 rounded-full text-xs font-medium text-gray-600 dark:text-gray-300"
          >
            {{ post.category.name }}
          </span>
          <span class="flex items-center gap-1 ml-auto">
            <Icon icon="lucide:eye" class="w-4 h-4" />
            {{ post.views || 0 }}
          </span>
        </div>

        <p
          v-if="post.excerpt"
          class="text-gray-600 dark:text-gray-300 mb-4 line-clamp-2 leading-relaxed"
        >
          {{ post.excerpt }}
        </p>

        <div class="flex flex-wrap gap-2 pt-2 border-t border-gray-50 dark:border-gray-800">
          <span
            v-for="tag in post.tags" :key="tag.id"
            class="text-xs px-3 py-1.5 bg-gradient-to-r from-blue-50 dark:from-blue-900/30 to-indigo-50 dark:to-indigo-900/30 text-blue-600 dark:text-blue-400 rounded-full font-medium hover:from-blue-100 dark:hover:from-blue-900/50 hover:to-indigo-100 dark:hover:to-indigo-900/50 transition-colors duration-200"
          >
            #{{ tag.name }}
          </span>
        </div>
      </div>
    </NuxtLink>
  </article>
</template>
