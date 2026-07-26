<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

const isVisible = ref(false);
const isHovered = ref(false);

function toggleVisibility() {
  // Show button when scrolled down 300px
  isVisible.value = window.scrollY > 300;
}

function scrollToTop() {
  window.scrollTo({
    top: 0,
    behavior: 'smooth',
  });
}

onMounted(() => {
  window.addEventListener('scroll', toggleVisibility, { passive: true });
});

onUnmounted(() => {
  window.removeEventListener('scroll', toggleVisibility);
});
</script>

<template>
  <button
    v-if="isVisible"
    @click="scrollToTop"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
    class="fixed bottom-6 right-6 z-50 p-3 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg hover:shadow-xl transition-all duration-300 ease-out"
    :class="[isHovered ? 'scale-110' : 'scale-100',
             'hover:border-blue-300 dark:hover:border-blue-600',
             'hover:text-blue-600 dark:hover:text-blue-400',
             'text-gray-500 dark:text-gray-400']"
    title="返回顶部"
  >
    <Icon
      icon="lucide:arrow-up"
      :class="['w-5 h-5 transition-transform', isHovered ? '-translate-y-0.5' : '']"
    />
  </button>
</template>
