<script setup lang="ts">
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

const zoomed = ref(false);
const zoomOrigin = ref({ x: 50, y: 50 });

function handlePrev() { if (hasPrev.value) emit("navigate", props.currentIndex - 1); }
function handleNext() { if (hasNext.value) emit("navigate", props.currentIndex + 1); }
function toggleZoom() { zoomed.value = !zoomed.value; }

function handleMouseMove(e: MouseEvent) {
	if (!zoomed.value) return;
	const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
	zoomOrigin.value = {
		x: ((e.clientX - rect.left) / rect.width) * 100,
		y: ((e.clientY - rect.top) / rect.height) * 100,
	};
}

function handleKeyDown(e: KeyboardEvent) {
	switch (e.key) {
		case "Escape": emit("close"); break;
		case "ArrowLeft": handlePrev(); break;
		case "ArrowRight": handleNext(); break;
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
  <Transition name="lightbox">
    <div
      role="dialog"
      aria-modal="true"
      aria-label="图片查看器"
      class="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center"
      @click="emit('close')"
    >
      <button
        class="absolute top-4 right-4 p-2 text-white/70 hover:text-white transition-colors z-20 rounded-full hover:bg-white/10"
        title="关闭 (ESC)"
        aria-label="关闭"
        @click="emit('close')"
      >
        <Icon icon="lucide:x" class="w-6 h-6" />
      </button>

      <div v-if="images.length > 1" class="absolute top-4 left-1/2 -translate-x-1/2 text-white/60 text-sm z-20 bg-black/30 px-3 py-1 rounded-full">
        {{ currentIndex + 1 }} / {{ images.length }}
      </div>

      <!-- Zoom toggle -->
      <button
        class="absolute bottom-4 right-4 p-2 text-white/60 hover:text-white transition-colors z-20 rounded-full hover:bg-white/10"
        title="点击缩放"
        @click.stop="toggleZoom"
      >
        <Icon :icon="zoomed ? 'lucide:zoom-out' : 'lucide:zoom-in'" class="w-5 h-5" />
      </button>

      <div
        v-if="currentImage"
        class="relative max-w-[85vw] max-h-[85vh] flex items-center justify-center"
        @click.stop
      >
        <img
          :src="currentImage.src"
          :alt="currentImage.alt"
          class="max-w-full max-h-[85vh] object-contain rounded-lg select-none transition-transform duration-200 ease-out cursor-crosshair"
          :class="{ 'scale-150': zoomed }"
          :style="zoomed ? { transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%` } : {}"
          draggable="false"
          @mousemove="handleMouseMove"
        >
      </div>

      <!-- Prev/Next -->
      <div v-if="images.length > 1">
        <button
          class="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-all text-white/80 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed"
          :disabled="!hasPrev"
          title="上一张 (←)"
          aria-label="上一张图片"
          @click.stop="handlePrev"
        >
          <Icon icon="lucide:chevron-left" class="w-6 h-6" />
        </button>
        <button
          class="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-all text-white/80 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed"
          :disabled="!hasNext"
          title="下一张 (→)"
          aria-label="下一张图片"
          @click.stop="handleNext"
        >
          <Icon icon="lucide:chevron-right" class="w-6 h-6" />
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.lightbox-enter-active { transition: opacity 0.2s ease; }
.lightbox-leave-active { transition: opacity 0.15s ease; }
.lightbox-enter-from,
.lightbox-leave-to { opacity: 0; }
</style>
