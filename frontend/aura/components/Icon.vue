<script setup lang="ts">
import { Icon as IconifyIcon } from "@iconify/vue";

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
  <IconifyIcon
    :icon="props.icon"
    :width="props.width"
    :height="props.height"
    :class="props.class"
  />
</template>
