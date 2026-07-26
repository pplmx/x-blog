<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { usePostView } from '~/composables/useApi';

interface Props {
  postId: number;
}

const props = defineProps<Props>();

const hasTracked = ref(false);

onMounted(() => {
  if (hasTracked.value) return;
  hasTracked.value = true;

  // Increment view count on client side
  usePostView(props.postId).catch(console.error);
});
</script>

<!-- This component renders nothing — it just tracks views -->
<template>
  <div v-show="false" />
</template>
