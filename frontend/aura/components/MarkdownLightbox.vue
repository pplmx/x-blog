<!--
  MarkdownLightbox.vue (DEC-302, TASK-379)

  Fullscreen viewer for post images — the click target behind every image
  the post body renders. MarkdownContent's header has long documented images
  as "lightbox-ready"; this closes that gap: clicking a post image opens it at
  full resolution in a dark overlay so tall diagrams / screenshots / photos
  can be inspected closely on any screen (a column-width rendering can't be
  scrutinised on mobile).

  Contract:
    - renders nothing while `index` is null; any non-null index opens on it
    - Escape / backdrop / close button close (emit "update:index", null)
    - ArrowLeft/ArrowRight browse the post's images with wrap-around
    - focus moves into the dialog on open and returns to the trigger on close
    - body scroll is locked while open
    - `print:hidden`: the overlay never leaks into a printed/PDF page

  The overlay teleports to <body> so no ancestor (overflow-hidden post body,
  mobile TOC sheet, …) can clip or stack it accidentally.
-->
<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

export interface LightboxImage {
	src: string;
	alt: string;
}

const props = defineProps<{
	images: LightboxImage[];
	/** Currently shown image index, or null when closed. */
	index: number | null;
}>();

const emit = defineEmits<{
	"update:index": [index: number | null];
}>();

const { t } = useLang();

const dialogRef = ref<HTMLElement | null>(null);
// Captured when the overlay opens so close can hand keyboard focus back.
let triggerEl: HTMLElement | null = null;
let prevOverflow = "";
// Tracks open/close edges (not index changes) so a same-open navigation
// between images leaves focus + scroll untouched.
let opened = false;

const current = (): LightboxImage | null => {
	if (props.index === null) return null;
	return props.images[props.index] ?? null;
};

function clamp(i: number): number {
	return ((i % props.images.length) + props.images.length) % props.images.length;
}

function close(): void {
	emit("update:index", null);
}

function step(dir: 1 | -1): void {
	if (props.index === null || props.images.length === 0) return;
	emit("update:index", clamp(props.index + dir));
}

function onKeydown(event: KeyboardEvent): void {
	switch (event.key) {
		case "Escape":
			event.preventDefault();
			close();
			break;
		case "ArrowRight":
			event.preventDefault();
			step(1);
			break;
		case "ArrowLeft":
			event.preventDefault();
			step(-1);
			break;
		case "Tab": {
			// Keep Tab cycling inside the modal: a modal must not leak focus to
			// the page behind the overlay (modal a11y). Wrap at the edges.
			const focusable = dialogRef.value?.querySelectorAll<HTMLElement>(
				'button, [href], [tabindex]:not([tabindex="-1"])',
			);
			const root = dialogRef.value;
			const first = focusable?.[0];
			const last = focusable?.[focusable.length - 1];
			if (!root || !first || !last) {
				event.preventDefault();
				break;
			}
			const active = document.activeElement;
			if (event.shiftKey && (active === first || !root.contains(active))) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && (active === last || !root.contains(active))) {
				event.preventDefault();
				first.focus();
			}
			break;
		}
	}
}

watch(
	() => props.index,
	async (index) => {
		const wasOpen = opened;
		opened = index !== null;
		// A same-open navigation between images keeps focus/scroll as-is.
		if (index !== null && !wasOpen) {
			// Open is a client-only transition (the parent never mounts with a
			// non-null index), but guard anyway so an SSR render with a
			// pre-set index can't touch `document` on the server.
			if (typeof document === "undefined") return;
			triggerEl = (document.activeElement as HTMLElement | null) ?? null;
			prevOverflow = document.body.style.overflow;
			document.body.style.overflow = "hidden";
			await nextTick();
			dialogRef.value?.focus();
		} else if (index === null && wasOpen) {
			document.body.style.overflow = prevOverflow;
			triggerEl?.focus();
			triggerEl = null;
		}
	},
	{ immediate: true },
);

// The owning post can be swapped out while the viewer is open (SPA
// navigation between posts reuses this MarkdownContent instance): if the new
// image set no longer covers the open index, close gracefully and restore
// scroll + focus directly (not by relying on the parent honouring the
// v-model write-back) — never leave body overflow hidden behind an invisible
// overlay.
watch(
	() => props.images.length,
	(len) => {
		if (props.index === null || (len !== 0 && props.index < len)) return;
		if (opened) {
			document.body.style.overflow = prevOverflow;
			triggerEl?.focus();
			triggerEl = null;
			opened = false;
		}
		close();
	},
);

// Unmounted while open (reader navigates away mid-view): never strand body
// scroll-lock on the next page.
onBeforeUnmount(() => {
	if (opened) document.body.style.overflow = prevOverflow;
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="index !== null && current()"
      ref="dialogRef"
      class="fixed inset-0 z-[120] flex items-center justify-center p-4 print:hidden"
      role="dialog"
      aria-modal="true"
      :aria-label="t('components.markdown.lightboxDialogAria')"
      tabindex="-1"
      data-testid="lightbox"
      @keydown="onKeydown"
    >
      <!-- Backdrop: click anywhere outside the image closes -->
      <div class="absolute inset-0 bg-black/85" data-testid="lightbox-backdrop" @click="close" />

      <!-- The image, at full resolution, fitting the viewport -->
      <figure class="relative z-10 flex max-h-full max-w-full flex-col items-center gap-3">
        <img
          :src="current()!.src"
          :alt="current()!.alt"
          class="max-h-[78vh] max-w-full rounded-lg object-contain shadow-2xl"
          data-testid="lightbox-image"
        />
        <figcaption
          class="flex items-center gap-3 text-sm text-gray-200"
        >
          <!-- Sighted readers get the count; the sr-only aria-live region
               announces the same position to screen readers (the visible
               "n / total" alone reads as bare numbers, and aria-hidden on it
               left SR users with no sense of which image they were on). -->
          <span class="sr-only" role="status" aria-live="polite">
            {{ t("components.markdown.lightboxCounter", { current: (index ?? 0) + 1, total: images.length }) }}
          </span>
          <span aria-hidden="true" data-testid="lightbox-counter">
            {{ index! + 1 }} / {{ images.length }}
          </span>
          <span v-if="current()!.alt" class="max-w-xl truncate text-gray-300">
            {{ current()!.alt }}
          </span>
        </figcaption>
      </figure>

      <!-- Close -->
      <button
        type="button"
        class="absolute top-4 right-4 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white"
        :aria-label="t('components.markdown.lightboxClose')"
        data-testid="lightbox-close"
        @click="close"
      >
        <span aria-hidden="true" class="text-2xl leading-none">&times;</span>
      </button>

      <!-- Image browsing (only meaningful with 2+ images) -->
      <template v-if="images.length > 1">
        <button
          type="button"
          class="absolute top-1/2 left-2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white"
          :aria-label="t('components.markdown.lightboxPrevious')"
          data-testid="lightbox-prev"
          @click="step(-1)"
        >
          <Icon icon="lucide:chevron-left" class="h-6 w-6" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="absolute top-1/2 right-2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white"
          :aria-label="t('components.markdown.lightboxNext')"
          data-testid="lightbox-next"
          @click="step(1)"
        >
          <Icon icon="lucide:chevron-right" class="h-6 w-6" aria-hidden="true" />
        </button>
      </template>
    </div>
  </Teleport>
</template>
