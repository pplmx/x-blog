<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";

interface LightboxImage {
	src: string;
	alt: string;
}

interface Props {
	images: LightboxImage[];
	currentIndex: number;
}

const props = withDefaults(defineProps<Props>(), {
	images: () => [],
	currentIndex: 0,
});

const emit = defineEmits<{
	(e: "close"): void;
	(e: "navigate", index: number): void;
}>();

const currentImage = computed(() => props.images[props.currentIndex]);
const hasPrev = computed(() => props.currentIndex > 0);
const hasNext = computed(() => props.currentIndex < props.images.length - 1);

function handlePrev() {
	if (hasPrev.value) emit("navigate", props.currentIndex - 1);
}

function handleNext() {
	if (hasNext.value) emit("navigate", props.currentIndex + 1);
}

function handleKeyDown(e: KeyboardEvent) {
	switch (e.key) {
		case "Escape":
			emit("close");
			break;
		case "ArrowLeft":
			handlePrev();
			break;
		case "ArrowRight":
			handleNext();
			break;
	}
}

onMounted(() => {
	document.addEventListener("keydown", handleKeyDown);
	document.body.style.overflow = "hidden";
});

onUnmounted(() => {
	document.removeEventListener("keydown", handleKeyDown);
	document.body.style.overflow = "";
});
</script>

<template>
  <div
    role="dialog"
    aria-modal="true"
    aria-label="图片查看器"
    class="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center"
    @click="emit('close')"
  >
    <!-- Close button -->
    <button
      @click="emit('close')"
      class="absolute top-4 right-4 p-2 text-white/80 hover:text-white transition-colors z-10"
      title="关闭 (ESC)"
      aria-label="关闭"
    >
      <Icon icon="lucide:x" class="w-8 h-8" />
    </button>

    <!-- Image counter -->
    <div
      v-if="images.length > 1"
      class="absolute top-4 left-1/2 -translate-x-1/2 text-white/80 text-sm"
      aria-live="polite"
    >
      {{ currentIndex + 1 }} / {{ images.length }}
    </div>

    <!-- Image container -->
    <div
      v-if="currentImage"
      role="img"
      :aria-label="currentImage.alt"
      class="relative max-w-[90vw] max-h-[90vh]"
      @click.stop
    >
      <img
        :src="currentImage.src"
        :alt="currentImage.alt"
        class="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
      >
    </div>

    <!-- Navigation buttons -->
    <div v-if="images.length > 1">
      <button
        @click.stop="handlePrev"
        :disabled="!hasPrev"
        class="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
        :class="[!hasPrev ? 'opacity-30 cursor-not-allowed' : 'text-white']"
        title="上一张 (←)"
        aria-label="上一张图片"
      >
        <Icon icon="lucide:chevron-left" class="w-6 h-6" />
      </button>

      <button
        @click.stop="handleNext"
        :disabled="!hasNext"
        class="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
        :class="[!hasNext ? 'opacity-30 cursor-not-allowed' : 'text-white']"
        title="下一张 (→)"
        aria-label="下一张图片"
      >
        <Icon icon="lucide:chevron-right" class="w-6 h-6" />
      </button>
    </div>
  </div>
</template>
