<script setup lang="ts">
import { Icon as IconifyIcon } from "@iconify/vue";

defineProps<{
	icon: string;
	width?: number | string;
	height?: number | string;
	class?: string;
}>();
</script>

<template>
  <IconifyIcon
    :icon="icon"
    :width="width"
    :height="height"
    :class="class"
  />
</template>
