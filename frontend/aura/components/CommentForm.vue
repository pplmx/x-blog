<template>
  <section>
    <h2 class="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">{{ submitLabel || t('components.commentForm.title') }}</h2>

    <!-- Reply context -->
    <div
      v-if="replyingTo"
      class="flex items-center justify-between gap-2 mb-4 px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/40"
    >
      <p class="text-sm text-blue-700 dark:text-blue-300">
        {{ t('components.commentForm.replyingTo', { name: replyingTo }) }}
      </p>
      <button
        type="button"
        class="text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-200 transition-colors"
        @click="emit('cancel')"
      >
        {{ t('components.commentForm.cancelReply') }}
      </button>
    </div>

    <form @submit.prevent="handleSubmit" class="space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <input
          v-model="form.nickname"
          type="text"
          required
          :placeholder="t('components.commentForm.nickname')"
          class="px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        >
        <input
          v-model="form.email"
          type="email"
          required
          :placeholder="t('components.commentForm.email')"
          class="px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        >
      </div>

      <textarea
        v-model="form.content"
        required
        rows="4"
        :placeholder="t('components.commentForm.content')"
        class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-y"
      />

      <button
        type="submit"
        :disabled="submitting"
        class="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
      >
        <Icon
          v-if="submitting"
          icon="lucide:loader-2"
          class="w-4 h-4 animate-spin"
        />
        {{ submitting ? t('components.commentForm.submitting') : t('components.commentForm.submit') }}
      </button>

      <p v-if="error" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
      <p v-if="success" class="text-sm text-green-600 dark:text-green-400">{{ t('components.commentForm.submitSuccess') }}</p>
    </form>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { createComment } from "~~/composables/useApi";

interface Props {
	postId: number;
	parentId?: number | null;
	replyingTo?: string | null;
	submitLabel?: string | null;
}

const props = withDefaults(defineProps<Props>(), {
	parentId: undefined,
	replyingTo: undefined,
	submitLabel: undefined,
});

const emit = defineEmits<{ submitted: []; cancel: [] }>();

const { t } = useLang();

const form = ref({
	nickname: "",
	email: "",
	content: "",
});

const submitting = ref(false);
const error = ref("");
const success = ref("");

// Reset the form whenever the reply target changes.
watch(
	() => props.parentId,
	() => {
		form.value = { nickname: "", email: "", content: "" };
		error.value = "";
		success.value = "";
	},
);

async function handleSubmit() {
	if (!(form.value.nickname && form.value.email && form.value.content)) return;

	submitting.value = true;
	error.value = "";
	success.value = "";

	try {
		await createComment(props.postId, {
			nickname: form.value.nickname,
			email: form.value.email,
			content: form.value.content,
			parent_id: props.parentId ?? null,
		});
		success.value = t("components.commentForm.submitSuccess");
		form.value = { nickname: "", email: "", content: "" };
		emit("submitted");
	} catch (e: any) {
		error.value = e?.message || t("components.commentForm.submitFailed");
	} finally {
		submitting.value = false;
	}
}
</script>
