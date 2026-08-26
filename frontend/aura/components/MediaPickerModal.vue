<!--
  Media library picker (DEC-183) — lets an author pick a previously uploaded
  image to insert into their post. Used by the post editor toolbar as an
  alternative to uploading a new file. Emits the relative /static/uploads/...
  URL on selection.
-->
<script setup lang="ts">
import { useAdminMedia } from "~~/api/admin/media";
import type { UploadFileInfo } from "~~/api/contracts/media";

const props = withDefaults(
	defineProps<{ open: boolean; pageSize?: number }>(),
	{ pageSize: 60 },
);
const emit = defineEmits<{ close: []; select: [url: string] }>();

const { t } = useLang();

const currentPage = ref(0);
// fetch lazily only when opened (server:false keeps SSR/CSR honest); refresh
// on open so a brand-new upload appears immediately.
const { data, pending, refresh } = await useAdminMedia(1, props.pageSize);
const items = computed(() => data.value?.items ?? []);
const totalPages = computed(() => data.value?.pagination?.total_pages ?? 0);

watch(
	() => props.open,
	(open) => {
		if (open) refresh();
	},
);

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
	refresh();
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      @click.self="emit('close')"
    >
      <div class="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-3xl max-h-[80vh] flex flex-col">
        <div class="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">{{ t("components.mediaPicker.title") }}</h3>
          <button
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
