<script setup lang="ts">
/**
 * Author preview page (DEC-150, TASK-187).
 *
 * Renders a not-yet-published post (draft/scheduled) as readers would see it,
 * pulling the admin-authenticated detail so the author can verify the final
 * look (title, cover, meta, markdown) before publish. Uses the "admin" layout,
 * which redirects unauthenticated visitors to /admin/login.
 */
import { computed, onMounted, ref } from "vue";
import {
	type AdminPostDetail,
	fetchAdminCategories,
	fetchAdminPost,
	fetchAdminTags,
} from "~~/composables/useApi";
import { coverImageSrc } from "~~/composables/useCoverImage";
import { readingMinutes } from "~~/composables/useReadingTime";
import { useSeo } from "~~/composables/useSeo";

definePageMeta({ layout: "admin" });

const { t, locale } = useLang();
const route = useRoute();
const post = ref<AdminPostDetail | null>(null);
const loading = ref(true);
const failed = ref(false);
const categories = ref<Array<{ id: number; name: string }>>([]);
const tags = ref<Array<{ id: number; name: string }>>([]);

useSeo({ title: t("preview.seoTitle"), path: "" });

const readingTime = computed(() => readingMinutes(post.value?.content));
const coverImageUrl = computed(() => (post.value ? coverImageSrc(post.value.title) : ""));
const categoryName = computed(
	() => categories.value.find((c) => c.id === post.value?.category_id)?.name,
);
const tagNames = computed(() =>
	(post.value?.tag_ids ?? [])
		.map((id) => tags.value.find((tg) => tg.id === id)?.name)
		.filter(Boolean),
);

onMounted(async () => {
	if (typeof localStorage === "undefined" || !localStorage.getItem("admin_token")) {
		return;
	}
	loading.value = true;
	try {
		const [res, cats, tgs] = await Promise.all([
			fetchAdminPost(Number(route.params.id)),
			fetchAdminCategories(),
			fetchAdminTags(),
		]);
		const data = res.data?.value;
		if (data) post.value = data;
		else failed.value = true;
		categories.value = cats.data?.value ?? [];
		tags.value = tgs.data?.value ?? [];
	} catch {
		failed.value = true;
	} finally {
		loading.value = false;
	}
});
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-12">
    <!-- Top bar: back + preview badge -->
    <div class="mb-10 flex items-center justify-between gap-4">
      <NuxtLink
        to="/admin/posts"
        class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-600 transition-colors"
      >
        <Icon icon="lucide:arrow-left" class="w-4 h-4" />
        {{ t('preview.back') }}
      </NuxtLink>
      <span class="inline-flex items-center gap-1 text-xs px-3 py-1 rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
        <Icon icon="lucide:eye" class="w-3.5 h-3.5" />
        {{ t('preview.badge') }}
      </span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="space-y-4">
      <div class="h-8 bg-gray-200 dark:bg-gray-800 rounded w-2/3 animate-pulse" />
      <div class="aspect-[2/1] bg-gray-200 dark:bg-gray-800 rounded-2xl animate-pulse" />
      <div class="h-4 bg-gray-200 dark:bg-gray-800 rounded w-full animate-pulse" />
      <div class="h-4 bg-gray-200 dark:bg-gray-800 rounded w-5/6 animate-pulse" />
    </div>

    <div v-else-if="failed || !post" class="text-center py-16 text-red-500">
      <Icon icon="lucide:alert-circle" class="w-10 h-10 mx-auto mb-3 text-red-300" />
      <p>{{ t('preview.loadFailed') }}</p>
    </div>

    <article v-else>
      <header class="mb-10">
        <div class="flex flex-wrap items-center gap-3 mb-4">
          <span
            v-if="categoryName"
            class="inline-flex items-center gap-1 px-3 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full text-xs font-medium"
          >
            <Icon icon="lucide:folder" class="w-3 h-3" />
            {{ categoryName }}
          </span>
          <span class="text-xs text-gray-400 flex items-center gap-1">
            <Icon icon="lucide:clock" class="w-3 h-3" />
            {{ t('post.readingTime', { count: readingTime }) }}
          </span>
          <span class="text-xs text-gray-400 flex items-center gap-1">
            <Icon icon="lucide:calendar" class="w-3.5 h-3.5" />
            {{ new Date(post.publish_at ?? post.created_at).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' }) }}
          </span>
        </div>

        <h1 class="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 dark:text-gray-100 leading-tight mb-6 text-balance">
          {{ post.title }}
        </h1>

        <p
          v-if="post.excerpt"
          class="mt-6 text-lg text-gray-600 dark:text-gray-400 leading-relaxed border-l-4 border-blue-200 dark:border-blue-800 pl-4 italic"
        >
          {{ post.excerpt }}
        </p>
      </header>

      <div class="relative w-full aspect-[2/1] rounded-2xl overflow-hidden mb-10 shadow-lg">
        <img :src="coverImageUrl" :alt="post.title" class="w-full h-full object-cover" />
        <div class="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent" />
      </div>

      <div v-if="post.content" class="prose-config">
        <MarkdownContent :content="post.content" />
      </div>

      <footer v-if="tagNames.length" class="mt-10 pt-8 border-t border-gray-100 dark:border-gray-800">
        <div class="flex flex-wrap gap-2">
          <span
            v-for="name in tagNames"
            :key="name"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-full text-xs font-medium"
          >
            <Icon icon="lucide:tag" class="w-3 h-3" />
            {{ name }}
          </span>
        </div>
      </footer>
    </article>
  </div>
</template>
