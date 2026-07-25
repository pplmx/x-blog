<script setup lang="ts">

const route = useRoute();
const tagId = route.query.tag_id ? parseInt(route.query.tag_id as string, 10) : undefined;

const { data: tags, pending: tagsPending } = await useTags();
const { data: posts, pending: postsPending } = await usePosts(
  tagId ? { tag_id: tagId, page: route.query.page ? parseInt(route.query.page as string, 10) : 1 } : undefined,
);
const pending = computed(() => tagsPending.value || postsPending.value);
</script>

<template>
  <div class="max-w-4xl mx-auto">
    <!-- Loading state -->
    <div v-if="pending" class="space-y-4">
      <div class="bg-gray-100 animate-pulse h-8 rounded-lg mb-4 w-1/3"></div>
      <div class="flex flex-wrap gap-3">
        <div
          v-for="i in 5"
          :key="i"
          class="bg-gray-100 animate-pulse h-10 rounded-xl w-20"
        ></div>
      </div>
    </div>

    <!-- All tags view (no tag_id selected) -->
    <div v-else-if="!tagId" class="space-y-6">
      <div class="mb-8">
        <h1
          class="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent mb-2"
        >
          所有标签
        </h1>
        <p class="text-gray-500 dark:text-gray-400">
          共 {{ tags?.length || 0 }} 个标签
        </p>
      </div>

      <div
        v-if="tags?.length"
        class="flex flex-wrap gap-3"
      >
        <NuxtLink
          v-for="tag in tags"
          :key="tag.id"
          :to="{ query: { tag_id: String(tag.id) } }"
          class="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl text-sm font-medium hover:from-blue-600 hover:to-indigo-600 transition-all shadow-md hover:shadow-lg"
        >
          #{{ tag.name }}
        </NuxtLink>
      </div>

      <div
        v-else
        class="text-center py-12 text-gray-500"
      >
        暂无标签
      </div>
    </div>

    <!-- Tag posts view (tag_id selected) -->
    <div v-else>
      <div class="mb-8">
        <NuxtLink
          to="/tags"
          class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-600 transition-colors mb-4"
        >
          <Icon icon="lucide:arrow-left" class="w-4 h-4" />
          返回所有标签
        </NuxtLink>
        <h1 class="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent">
          标签文章
        </h1>
      </div>

      <!-- Posts list -->
      <div
        v-if="posts?.items?.length"
        class="space-y-6"
      >
        <div
          v-for="post in posts.items"
          :key="post.id"
          class="border border-gray-100 rounded-lg p-6 hover:shadow-md transition-shadow"
        >
          <NuxtLink
            :to="`/posts/${post.slug}`"
            class="text-xl font-bold hover:text-blue-600"
          >
            {{ post.title }}
          </NuxtLink>
          <p
            v-if="post.excerpt"
            class="text-gray-600 mt-2 line-clamp-2"
          >
            {{ post.excerpt }}
          </p>
          <div class="flex gap-4 mt-3 text-sm text-gray-500">
            <span v-if="post.category">
              {{ post.category.name }}
            </span>
            <span>
              {{ new Date(post.created_at).toLocaleDateString() }}
            </span>
            <span>{{ post.views }} 次阅读</span>
          </div>
        </div>

        <!-- Pagination -->
        <div
          v-if="posts.pagination.total_pages > 1"
          class="flex justify-center gap-2 mt-8"
        >
          <button
            v-for="pg in posts.pagination.total_pages"
            :key="pg"
            :class="[
              'px-3 py-1 rounded',
              pg === posts.pagination.page
                ? 'bg-blue-600 text-white'
                : 'border hover:bg-gray-50',
            ]"
            @click="navigateTo({ query: { tag_id: String(tagId), page: pg } })"
          >
            {{ pg }}
          </button>
        </div>
      </div>

      <!-- Empty posts -->
      <div
        v-else
        class="text-center py-12 text-gray-500"
      >
        暂无文章
      </div>
    </div>
  </div>
</template>

<route lang="json">
{
  "meta": {
    "title": "标签",
    "description": "X-Blog - 浏览所有标签"
  }
}
</route>
