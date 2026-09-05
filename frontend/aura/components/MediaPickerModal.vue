<!--
  Media library picker (DEC-183) — lets an author pick a previously uploaded
  image to insert into their post. Used by the post editor toolbar as an
  alternative to uploading a new file. Emits the relative /static/uploads/...
  URL on selection.
-->
<script setup lang="ts">
import { useAdminMedia } from "~~/api/admin/media";
import type { UploadFileInfo } from "~~/api/contracts/media";

const props = withDefaults(defineProps<{ open: boolean; pageSize?: number }>(), { pageSize: 60 });
const emit = defineEmits<{ close: []; select: [url: string] }>();

const { t } = useLang();

// 0-based UI index (the pager shows currentPage + 1); useAdminMedia's listing
// path is computed from a 1-based page, so the pager ref is translated. Passing
// the computed ref (not a literal) is the point: useAdminMedia's `path`
// computed watches it and re-fetches on pagination, same as the admin media
// page (DEC-189) — the previous literal 1 left Next/Prev re-fetching page 1.
const currentPage = ref(0);
const apiPage = computed(() => currentPage.value + 1);
// Fetch lazily ONLY when opened: immediate:false suppresses the mount-time
// request, and the open-watcher below (immediate:true so a picker that mounts
// already open still requests) calls refresh() on every open. round 263 —
// the modal is always-mounted twice in the post editor (media + cover), so a
// plain eager useFetch fired two duplicate /api/upload/files?page_size=60
// calls on EVERY editor page load before the picker was ever opened, despite
// the old comment claiming laziness. server:false keeps SSR/CSR honest.
const { data, pending, error, refresh } = await useAdminMedia(apiPage, props.pageSize, undefined, {
	immediate: false,
});
const items = computed(() => data.value?.items ?? []);
const totalPages = computed(() => data.value?.pagination?.total_pages ?? 0);

// Dialog keyboard semantics (ISS-132, TASK-231): Escape closes, initial focus
// lands on the close button, Tab is trapped inside the panel, and focus
// returns to whatever opened the picker when it closes.
const closeButtonRef = ref<HTMLButtonElement | null>(null);
const panelRef = ref<HTMLDivElement | null>(null);
const previouslyFocused = ref<HTMLElement | null>(null);

watch(
	() => props.open,
	async (open) => {
		if (open) {
			previouslyFocused.value = document.activeElement as HTMLElement | null;
			// flush:"post" + an extra tick: the teleport moves its nodes during
			// its own render effect, so the panel may not be in the target
			// container until the next flush. Focus lands after that.
			await nextTick();
			closeButtonRef.value?.focus({ preventScroll: true });
			refresh();
		} else if (previouslyFocused.value) {
			previouslyFocused.value.focus({ preventScroll: true });
			previouslyFocused.value = null;
		}
	},
	// immediate: the initial fetch is suppressed (immediate:false above), so a
	// picker that mounts ALREADY open must still request its list — this is the
	// only path that now loads data.
	{ flush: "post", immediate: true },
);

onMounted(() => {
	const onKeydown = (e: KeyboardEvent) => {
		if (!props.open) return;
		if (e.key === "Escape") {
			emit("close");
			return;
		}
		if (e.key !== "Tab") return;
		const focusables = panelRef.value?.querySelectorAll<HTMLElement>(
			'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
		);
		if (!focusables || focusables.length === 0) return;
		const first = focusables.item(0);
		const last = focusables.item(focusables.length - 1);
		if (!first || !last) return;
		if (e.shiftKey && document.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	};
	window.addEventListener("keydown", onKeydown);
	onUnmounted(() => window.removeEventListener("keydown", onKeydown));
});

function imageUrl(item: UploadFileInfo): string {
	const config = useRuntimeConfig();
	return `${config.public.apiUrl}${item.url}`;
}

function select(item: UploadFileInfo) {
	emit("select", item.url);
	emit("close");
}

function goToPage(page: number) {
	if (page < 0 || page >= totalPages.value) return;
	currentPage.value = page;
	// No manual refresh: apiPage is a reactive source of useAdminMedia's path,
	// so useFetch re-fetches this page automatically.
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      @click.self="emit('close')"
    >
      <div
        ref="panelRef"
        role="dialog"
        aria-modal="true"
        :aria-label="t('components.mediaPicker.title')"
        class="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-3xl max-h-[80vh] flex flex-col"
      >
        <div class="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">{{ t("components.mediaPicker.title") }}</h3>
          <button
            ref="closeButtonRef"
            type="button"
            class="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            :aria-label="t('common.menu.close')"
            @click="emit('close')"
          >
            <Icon icon="lucide:x" class="w-5 h-5" />
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-4">
          <p v-if="pending" class="py-12 text-center text-sm text-gray-500 dark:text-gray-400">{{ t("components.mediaPicker.loading") }}</p>
          <!-- A failed fetch must not masquerade as "no media" — surface it
               with a retry (deep-dive finding). -->
          <div v-else-if="error" class="py-12 text-center" role="alert">
            <p class="text-sm text-red-600 dark:text-red-400 mb-3">{{ t("components.mediaPicker.loadFailed") }}</p>
            <button
              type="button"
              class="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              @click="refresh()"
            >
              {{ t("common.action.retry") }}
            </button>
          </div>
          <p v-else-if="items.length === 0" class="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            {{ t("components.mediaPicker.empty") }}
          </p>
          <div v-else class="grid grid-cols-3 sm:grid-cols-4 gap-3">
            <button
              v-for="item in items"
              :key="item.url"
              type="button"
              class="group rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 hover:border-blue-500 dark:hover:border-blue-400 transition-colors"
              :title="item.filename"
              @click="select(item)"
            >
              <div class="aspect-video bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
                <img :src="imageUrl(item)" :alt="item.filename" loading="lazy" class="w-full h-full object-contain">
              </div>
              <div class="px-2 py-1 text-[10px] text-gray-500 dark:text-gray-400 truncate">{{ item.filename }}</div>
            </button>
          </div>
        </div>

        <div v-if="totalPages > 1" class="flex items-center justify-between p-3 border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            :disabled="currentPage === 0"
            class="px-3 py-1 text-xs rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-40"
            @click="goToPage(currentPage - 1)"
          >
            {{ t("components.mediaPicker.prev") }}
          </button>
          <span class="text-xs text-gray-500 dark:text-gray-400">{{ currentPage + 1 }} / {{ totalPages }}</span>
          <button
            type="button"
            :disabled="currentPage >= totalPages - 1"
            class="px-3 py-1 text-xs rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-40"
            @click="goToPage(currentPage + 1)"
          >
            {{ t("components.mediaPicker.next") }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
