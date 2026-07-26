<template>
  <section>
    <h2 class="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">发表评论</h2>

    <form @submit.prevent="handleSubmit" class="space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <input
          v-model="form.nickname"
          type="text"
          required
          placeholder="昵称"
          class="px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        >
        <input
          v-model="form.email"
          type="email"
          required
          placeholder="邮箱（不会公开）"
          class="px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        >
      </div>

      <textarea
        v-model="form.content"
        required
        rows="4"
        placeholder="写点什么吧..."
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
        {{ submitting ? '提交中...' : '提交评论' }}
      </button>

      <p v-if="error" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
      <p v-if="success" class="text-sm text-green-600 dark:text-green-400">评论提交成功，等待审核中！</p>
    </form>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { createComment } from '~/composables/useApi';

interface Props {
  postId: number;
}

const props = defineProps<Props>();

const form = ref({
  nickname: '',
  email: '',
  content: '',
});

const submitting = ref(false);
const error = ref('');
const success = ref('');

async function handleSubmit() {
  if (!form.value.nickname || !form.value.email || !form.value.content) return;

  submitting.value = true;
  error.value = '';
  success.value = '';

  try {
    await createComment(props.postId, {
      nickname: form.value.nickname,
      email: form.value.email,
      content: form.value.content,
    });
    success.value = '评论提交成功，等待审核中！';
    form.value = { nickname: '', email: '', content: '' };
  } catch (e: any) {
    error.value = e?.message || '评论提交失败，请重试。';
  } finally {
    submitting.value = false;
  }
}
</script>
