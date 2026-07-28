<script setup lang="ts">
import { Icon } from "@iconify/vue";

void Icon;

defineProps<{
	icon: string;
	width?: number | string;
	height?: number | string;
	class?: string;
}>();
</script>

<template>
  <Icon
    :icon="icon"
    :width="width"
    :height="height"
    :class="class"
  />
</template>
