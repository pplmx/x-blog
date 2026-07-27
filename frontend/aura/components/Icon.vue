<script setup lang="ts">
import { Icon } from "@iconify/vue";

// Prevent noUnusedImports: Icon is used as a component in <template>
void Icon;

const props = defineProps<{
	icon: string;
	width?: number | string;
	height?: number | string;
	class?: string;
}>();

if (!props.icon) {
	console.warn("[Icon] Missing icon prop");
}
</script>

<template>
  <Icon
    :icon="props.icon"
    :width="props.width"
    :height="props.height"
    :class="props.class"
  />
</template>
