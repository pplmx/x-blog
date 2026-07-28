<script setup lang="ts">
import type { AdminPostDetail, PostCreate } from "~~/composables/useApi";
import {
	createAdminPost,
	fetchAdminCategories,
	fetchAdminPost,
	fetchAdminTags,
	updateAdminPost,
} from "~~/composables/useApi";

const route = useRoute();
const isNew = route.params.id === "new";
const postId = isNew ? null : Number.parseInt(route.params.id as string, 10);

const formData = ref<Partial<PostCreate>>({
	title: "",
	slug: "",
	content: "",
	excerpt: "",
	published: false,
	pinned: false,
	publish_at: null,
	category_id: undefined,
	tag_ids: [],
	cover_image: undefined,
});
const isSubmitting = ref(false);
const submitError = ref<string | null>(null);
const categories = ref<Array<{ id: number; name: string }>>([]);
const tags = ref<Array<{ id: number; name: string }>>([]);
const existingPost = ref<AdminPostDetail | null>(null);

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
				publish_at: val.publish_at || null,
				category_id: val.category_id || undefined,
				tag_ids: val.tag_ids || [],
				cover_image: val.cover_image || undefined,
			};
		}
	},
	{ immediate: true },
);

function generateSlug(title: string) {
	return title
		.toLowerCase()
		.replace(/[^\w\s-]/g, "")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.trim();
}

async function handleSubmit(e: Event) {
	e.preventDefault();
	isSubmitting.value = true;
	submitError.value = null;

	const payload = { ...formData.value };
	if (payload.publish_at) {
		payload.publish_at = `${payload.publish_at}:00Z`;
	}

	try {
		if (isNew) {
			await createAdminPost(payload);
		} else if (postId) {
			await updateAdminPost(postId, payload);
		}
		navigateTo("/admin/posts", { replace: true });
	} catch (err) {
		submitError.value = "保存文章失败，请重试。";
		console.error("Failed to save post:", err);
	} finally {
		isSubmitting.value = false;
	}
}

function handleCancel() {
	navigateTo("/admin/posts", { replace: true });
}

function toggleTag(tagId: number) {
	const current = formData.value.tag_ids || [];
	if (current.includes(tagId)) {
		formData.value.tag_ids = current.filter((id) => id !== tagId);
	} else {
		formData.value.tag_ids = [...current, tagId];
	}
}

const textareaRef = ref<HTMLTextAreaElement | null>(null);
const showPreview = ref(false);
const { uploadImage, isUploading, error: uploadError } = useUpload();

function insertMarkdown(before: string, after = "") {
	const ta = textareaRef.value;
	if (!ta) return;
	const start = ta.selectionStart;
	const end = ta.selectionEnd;
	const text = formData.value.content || "";
	const selected = text.slice(start, end);
	const replacement = `${before}${selected}${after}`;
	formData.value.content = text.slice(0, start) + replacement + text.slice(end);
	requestAnimationFrame(() => {
		ta.focus();
		ta.selectionStart = ta.selectionEnd = start + replacement.length - after.length;
	});
}

function wrapSelection(prefix: string, suffix: string) {
	insertMarkdown(prefix, suffix);
}

function insertHeading(level: number) {
	const prefix = "#".repeat(level) + " ";
	insertMarkdown(prefix);
}

function insertLink() {
	const ta = textareaRef.value;
	if (!ta) return;
	const start = ta.selectionStart;
	const end = ta.selectionEnd;
	const text = formData.value.content || "";
	const selected = text.slice(start, end);
	if (selected) {
		formData.value.content = text.slice(0, start) + `[${selected}](url)` + text.slice(end);
		requestAnimationFrame(() => {
			ta.focus();
			ta.selectionStart = start + selected.length + 3;
			ta.selectionEnd = start + selected.length + 6;
		});
	} else {
		insertMarkdown("[", "](url)");
	}
}

async function handleImageUpload(file: File) {
	const url = await uploadImage(file);
	if (url) {
		insertMarkdown(`![image](${url})`);
	}
}

function onPaste(e: ClipboardEvent) {
	const items = e.clipboardData?.items;
	if (!items) return;
	for (const item of items) {
		if (item.type.startsWith("image/")) {
			e.preventDefault();
			const file = item.getAsFile();
			if (file) handleImageUpload(file);
			return;
		}
	}
}

function onDrop(e: DragEvent) {
	const files = e.dataTransfer?.files;
	if (!files || files.length === 0) return;
	for (const file of Array.from(files)) {
		if (file.type.startsWith("image/")) {
			e.preventDefault();
			handleImageUpload(file);
			return;
		}
	}
}

function onDragOver(e: DragEvent) {
	e.preventDefault();
}

function triggerImagePicker() {
	const input = document.getElementById("image-upload-input") as HTMLInputElement | null;
	if (input) input.click();
}

function handleFileInput(e: Event) {
	const input = e.target as HTMLInputElement;
	const file = input.files?.[0];
	if (file) handleImageUpload(file);
	input.value = "";
}
</script>

<template>
  <div class="max-w-4xl">
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

    <div v-if="!isNew && postPending" class="text-center py-12">
      <div class="inline-flex items-center gap-2 text-gray-500">
        <svg aria-label="加载中" class="animate-spin w-5 h-5" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        加载中...
      </div>
    </div>

    <div v-else-if="!isNew && postError" class="text-center py-12 text-red-500">
      {{ postError?.message || '加载文章失败' }}
    </div>

    <form v-else @submit.prevent="handleSubmit" class="space-y-6">
      <div v-if="submitError" class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400">
        {{ submitError }}
      </div>

      <div class="bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 space-y-5">
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
          <button
            v-if="!isNew || !formData.slug"
            type="button"
            @click="formData.slug = generateSlug(formData.title || '')"
            class="mt-2 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            自动生成 Slug
          </button>
        </div>

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

      <div class="grid gap-4 sm:grid-cols-2">
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

      <div class="bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5">
        <div class="flex items-center justify-between mb-3">
          <label class="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
            <Icon icon="lucide:edit-3" class="w-4 h-4 text-blue-500" />
            内容 (Markdown) <span class="text-red-500">*</span>
          </label>
          <button
            type="button"
            @click="showPreview = !showPreview"
            class="text-xs px-3 py-1 rounded-lg transition-colors"
            :class="showPreview
              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'"
          >
            <Icon :icon="showPreview ? 'lucide:edit-3' : 'lucide:eye'" class="w-3.5 h-3.5 inline mr-1" />
            {{ showPreview ? '编辑' : '预览' }}
          </button>
        </div>

        <div class="flex items-center gap-1 mb-3 flex-wrap">
          <button type="button" @click="wrapSelection('**', '**')" title="加粗" class="toolbar-btn">
            <b>B</b>
          </button>
          <button type="button" @click="wrapSelection('*', '*')" title="斜体" class="toolbar-btn italic">
            <i>I</i>
          </button>
          <span class="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1" />
          <button type="button" @click="insertHeading(1)" title="标题 1" class="toolbar-btn">H1</button>
          <button type="button" @click="insertHeading(2)" title="标题 2" class="toolbar-btn">H2</button>
          <button type="button" @click="insertHeading(3)" title="标题 3" class="toolbar-btn">H3</button>
          <span class="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1" />
          <button type="button" @click="insertLink()" title="链接" class="toolbar-btn">
            <Icon icon="lucide:link" class="w-3.5 h-3.5" />
          </button>
          <button type="button" @click="triggerImagePicker" :disabled="isUploading" title="上传图片" class="toolbar-btn">
            <Icon :icon="isUploading ? 'lucide:loader-2' : 'lucide:image'" :class="{ 'animate-spin': isUploading }" class="w-3.5 h-3.5" />
          </button>
          <input id="image-upload-input" type="file" accept="image/*" class="hidden" @change="handleFileInput">
        </div>

        <div
          class="relative"
          @dragover="onDragOver"
          @drop="onDrop"
        >
          <div v-if="showPreview" class="grid grid-cols-2 gap-4">
            <textarea
              ref="textareaRef"
              v-model="formData.content"
              rows="15"
              required
              placeholder="使用 Markdown 编写文章内容..."
              class="w-full font-mono text-sm px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
              @paste="onPaste"
            />
            <div class="prose prose-sm dark:prose-invert max-w-none overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <div v-html="formData.content" />
            </div>
          </div>
          <textarea
            v-else
            ref="textareaRef"
            v-model="formData.content"
            rows="15"
            required
            placeholder="使用 Markdown 编写文章内容..."
            class="w-full font-mono text-sm px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
            @paste="onPaste"
          />
          <div
            v-if="isUploading"
            class="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 rounded-xl"
          >
            <div class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <Icon icon="lucide:loader-2" class="w-5 h-5 animate-spin" />
              上传中...
            </div>
          </div>
          <div
            v-if="uploadError"
            class="mt-2 text-xs text-red-500"
          >
            {{ uploadError }}
          </div>
        </div>

        <p class="text-xs text-gray-400 dark:text-gray-500 mt-2">
          支持 Markdown 语法，可拖拽或粘贴图片自动上传
        </p>
      </div>

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

        <div class="flex items-start gap-3">
          <input
            id="publish_at"
            v-model="formData.publish_at"
            type="datetime-local"
            class="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
          >
          <label for="publish_at" class="text-sm font-medium text-gray-700 dark:text-gray-300 pt-1.5 whitespace-nowrap">
            定时发布 (可选)
          </label>
        </div>

        <div class="flex items-start gap-3">
          <input
            id="cover_image"
            v-model="formData.cover_image"
            type="text"
            placeholder="https://example.com/image.jpg"
            class="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
          >
          <label for="cover_image" class="text-sm font-medium text-gray-700 dark:text-gray-300 pt-1.5 whitespace-nowrap">
            封面图 URL
          </label>
        </div>
      </div>

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
