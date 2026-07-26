<!--
  Admin Post Editor Page
  Handles both creating new posts and editing existing posts.
  Route: /admin/posts/new (create) or /admin/posts/:id (edit)

  Uses Nuxt's useFetch for data loading (categories, tags, existing post).
  Follows the same form structure as the Next.js PostForm component.
-->
<script setup lang="ts">
import { ref, watch } from "vue";
import type { AdminPostDetail, PostCreate } from "~/composables/useApi";

const route = useRoute();
const isNew = route.params.id === "new";
const postId = isNew ? null : Number.parseInt(route.params.id as string, 10);

// Form data
const formData = ref<Partial<PostCreate>>({
	title: "",
	slug: "",
	content: "",
	excerpt: "",
	published: false,
	pinned: false,
	category_id: undefined,
	tag_ids: [],
	cover_image: undefined,
});
const isSubmitting = ref(false);
const submitError = ref<string | null>(null);
const categories = ref<Array<{ id: number; name: string }>>([]);
const tags = ref<Array<{ id: number; name: string }>>([]);
const existingPost = ref<AdminPostDetail | null>(null);

// Fetch categories and tags on mount
const { data: catsData } = await fetchAdminCategories();
const { data: tagsData } = await fetchAdminTags();

watch(
	() => catsData.value,
	(val) => {
		if (val) categories.value = val;
	},
	{ immediate: true },
);
watch(
	() => tagsData.value,
	(val) => {
		if (val) tags.value = val;
	},
	{ immediate: true },
);

// Fetch existing post if editing
const {
	data: postData,
	pending: postPending,
	error: postError,
} = postId
	? await fetchAdminPost(postId)
	: {
			data: ref(null) as any,
			pending: ref(false) as any,
			error: ref(null) as any,
		};

watch(
	() => postData.value,
	(val) => {
		if (val) {
			existingPost.value = val;
			formData.value = {
				title: val.title || "",
				slug: val.slug || "",
				content: val.content || "",
				excerpt: val.excerpt || "",
				published: val.published,
				pinned: val.pinned,
				category_id: val.category_id || undefined,
				tag_ids: val.tag_ids || [],
				cover_image: val.cover_image || undefined,
			};
		}
	},
	{ immediate: true },
);

// Generate slug from title (basic implementation)
function generateSlug(title: string) {
	return title
		.toLowerCase()
		.replace(/[^\w\s-]/g, "")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.trim();
}

// Handle form submission
async function handleSubmit(e: Event) {
	e.preventDefault();
	isSubmitting.value = true;
	submitError.value = null;

	try {
		if (isNew) {
			await createAdminPost(formData.value);
		} else if (postId) {
			await updateAdminPost(postId, formData.value);
		}
		navigateTo("/admin/posts", { replace: true });
	} catch (err) {
		submitError.value = "保存文章失败，请重试。";
		console.error("Failed to save post:", err);
	} finally {
		isSubmitting.value = false;
	}
}

// Handle cancel
function handleCancel() {
	navigateTo("/admin/posts", { replace: true });
}

// Toggle tag selection
function toggleTag(tagId: number) {
	const current = formData.value.tag_ids || [];
	if (current.includes(tagId)) {
		formData.value.tag_ids = current.filter((id) => id !== tagId);
	} else {
		formData.value.tag_ids = [...current, tagId];
	}
}
</script>

<template>
  <div class="max-w-4xl">
    <!-- Page header -->
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">
        {{ isNew ? '新建文章' : '编辑文章' }}
      </h1>
      <NuxtLink
        to="/admin/posts"
        class="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
      >
        <Icon icon="lucide:arrow-left" class="w-4 h-4" />
        返回文章列表
      </NuxtLink>
    </div>

    <!-- Loading state (editing) -->
    <div v-if="!isNew && postPending" class="text-center py-12">
      <div class="inline-flex items-center gap-2 text-gray-500">
        <svg aria-label="加载中" class="animate-spin w-5 h-5" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        加载中...
      </div>
    </div>

    <!-- Error state -->
    <div v-else-if="!isNew && postError" class="text-center py-12 text-red-500">
      {{ postError?.message || '加载文章失败' }}
    </div>

    <!-- Form -->
    <form v-else @submit.prevent="handleSubmit" class="space-y-6">
      <!-- Submit error -->
      <div v-if="submitError" class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400">
        {{ submitError }}
      </div>

      <!-- Basic Info -->
      <div class="bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 space-y-5">
        <!-- Title -->
        <div>
          <label class="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            <Icon icon="lucide:file-text" class="w-4 h-4 text-blue-500" />
            标题 <span class="text-red-500">*</span>
          </label>
          <input
            v-model="formData.title"
            type="text"
            required
            placeholder="输入文章标题"
            class="w-full text-lg h-12 px-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
          >
          <!-- Auto-generate slug if empty -->
          <button
            v-if="!isNew || !formData.slug"
            type="button"
            @click="formData.slug = generateSlug(formData.title || '')"
            class="mt-2 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            自动生成 Slug
          </button>
        </div>

        <!-- Slug -->
        <div>
          <label class="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            <Icon icon="lucide:link" class="w-4 h-4 text-gray-400" />
            Slug
          </label>
          <input
            v-model="formData.slug"
            type="text"
            placeholder="article-slug"
            class="w-full font-mono px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
          >
          <p class="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
            URL: /posts/{{ formData.slug || 'slug' }}
          </p>
        </div>

        <!-- Excerpt -->
        <div>
          <label class="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            <Icon icon="lucide:align-left" class="w-4 h-4 text-gray-400" />
            摘要
          </label>
          <textarea
            v-model="formData.excerpt"
            rows="2"
            placeholder="输入文章摘要（可选）"
            class="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
          />
        </div>
      </div>

      <!-- Category & Tags -->
      <div class="grid gap-4 sm:grid-cols-2">
        <!-- Category -->
        <div class="bg-gradient-to-br from-purple-50 dark:from-purple-900/20 to-white dark:to-gray-900 border border-purple-100 dark:border-purple-900/30 rounded-2xl p-5">
          <label class="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            <Icon icon="lucide:folder" class="w-4 h-4 text-purple-500" />
            分类
          </label>
          <select
            v-model="formData.category_id"
            class="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
          >
            <option :value="undefined">选择分类</option>
            <option v-for="cat in categories" :key="cat.id" :value="cat.id">
              {{ cat.name }}
            </option>
          </select>
        </div>

        <!-- Tags -->
        <div class="bg-gradient-to-br from-pink-50 dark:from-pink-900/20 to-white dark:to-gray-900 border border-pink-100 dark:border-pink-900/30 rounded-2xl p-5">
          <label class="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            <Icon icon="lucide:tag" class="w-4 h-4 text-pink-500" />
            标签
          </label>
          <div v-if="tags.length > 0" class="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
            <label
              v-for="tag in tags"
              :key="tag.id"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm cursor-pointer transition-all"
              :class="formData.tag_ids?.includes(tag.id)
                ? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-md'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-pink-100 dark:hover:bg-pink-900/50'"
            >
              <input
                type="checkbox"
                class="sr-only"
                :checked="formData.tag_ids?.includes(tag.id) ?? false"
                @change="toggleTag(tag.id)"
              >
              #{{ tag.name }}
            </label>
          </div>
          <p v-else class="text-sm text-gray-400 dark:text-gray-500">暂无标签</p>
        </div>
      </div>

      <!-- Content (Markdown) -->
      <div class="bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5">
        <label class="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
          <Icon icon="lucide:edit-3" class="w-4 h-4 text-blue-500" />
          内容 (Markdown) <span class="text-red-500">*</span>
        </label>
        <textarea
          v-model="formData.content"
          rows="15"
          required
          placeholder="使用 Markdown 编写文章内容..."
          class="w-full font-mono text-sm px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
        />
        <p class="text-xs text-gray-400 dark:text-gray-500 mt-2">
          支持 Markdown 语法：标题、列表、代码块、链接等
        </p>
      </div>

      <!-- Publish Options -->
      <div class="bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 space-y-4">
        <div class="flex items-start gap-3">
          <input
            id="published"
            v-model="formData.published"
            type="checkbox"
            class="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 mt-0.5"
          >
          <label for="published" class="cursor-pointer">
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ formData.published ? '✅ 文章已发布' : '📝 保存为草稿' }}
            </span>
          </label>
        </div>

        <div class="flex items-start gap-3">
          <input
            id="pinned"
            v-model="formData.pinned"
            type="checkbox"
            class="w-5 h-5 rounded border-gray-300 text-amber-600 focus:ring-amber-500 mt-0.5"
          >
          <label for="pinned" class="cursor-pointer">
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ formData.pinned ? '📌 已置顶' : '📌 置顶文章' }}
            </span>
          </label>
        </div>
      </div>

      <!-- Form Actions -->
      <div class="flex items-center gap-3 pt-2">
        <button
          type="submit"
          :disabled="isSubmitting"
          class="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-medium hover:from-blue-600 hover:to-indigo-600 shadow-lg shadow-blue-500/20 transition-all disabled:opacity-50"
        >
          <Icon :icon="isSubmitting ? 'lucide:loader-2' : 'lucide:save'" class="w-4 h-4" :class="{ 'animate-spin': isSubmitting }" />
          {{ isSubmitting ? '保存中...' : '保存文章' }}
        </button>
        <button
          type="button"
          @click="handleCancel"
          class="inline-flex items-center gap-2 px-6 py-3 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-all"
        >
          <Icon icon="lucide:x" class="w-4 h-4" />
          取消
        </button>
      </div>
    </form>
  </div>
</template>
