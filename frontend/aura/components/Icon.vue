<script setup lang="ts">
// Offline build of @iconify/vue: renders from the bundled lucide subset in
// assets/icons/lucide.ts (see scripts/generate-lucide-icons.mjs). No fetch to
// api.iconify.design at render time — icons paint on first frame instead of
// trickling in as each cross-origin JSON resolves (the original "icons load
// very slowly" problem). addCollection runs once at module load; lookups are
// a plain Map read, so repeated renders cost nothing extra.
import { Icon, addCollection } from "@iconify/vue/offline";
import lucideIcons from "~~/assets/icons/lucide";

addCollection(lucideIcons);

defineProps<{
	icon: string;
	width?: number | string;
	height?: number | string;
}>();
</script>

<template>
	<Icon :icon="icon" :width="width" :height="height" />
</template>
