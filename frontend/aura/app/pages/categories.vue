<script setup lang="ts">
import { computed } from "vue";
import { type PostListResponse, useApi, useCategories } from "~~/composables/useApi";
import { useSeo } from "~~/composables/useSeo";

const { t, locale } = useLang();
const route = useRoute();
// Reactive sources so SPA navigation that changes only query params
// (category_id / page) refetches — the computed URL drives useFetch.
const categoryId = computed(() =>
	route.query.category_id ? Number.parseInt(String(route.query.category_id), 10) : undefined,
);
const page = computed(() => (route.query.page ? Number.parseInt(String(route.query.page), 10) : 1));

const postsUrl = computed(() => {
	const params = new URLSearchParams();
	if (categoryId.value) params.set("category_id", String(categoryId.value));
	if (page.value > 1) params.set("page", String(page.value));
	const qs = params.toString();
	return qs ? `/api/posts?${qs}` : "/api/posts";
});

const { data: categories, pending: categoriesPending } = await useCategories();
const { data: posts, pending: postsPending } = await useApi<PostListResponse>(postsUrl);
const pending = computed(() => categoriesPending.value || postsPending.value);

// Look up the category name for SEO when a category is selected
const categoryName = computed(() =>
	categoryId.value ? categories.value?.find((c) => c.id === categoryId.value)?.name : undefined,
);

// SEO: set dynamic head metadata based on view state
useSeo({
	title: categoryName.value
		? t("categories.categoryTitle", { name: categoryName.value })
		: t("categories.all"),
	description: categoryName.value
		? t("categories.categoryDesc", { name: categoryName.value })
		: t("categories.allDesc"),
	path: "/categories",
});
</script>

<template>
  <div class="max-w-4xl mx-auto">
    <!-- Loading state -->
    <div v-if="pending" class="space-y-4">
      <div class="bg-gray-100 animate-pulse h-8 rounded-lg mb-4 w-1/3" />
      <div class="flex flex-wrap gap-3">
        <div
          v-for="i in 5"
          :key="i"
          class="bg-gray-100 animate-pulse h-10 rounded-xl w-20"
        />
      </div>
    </div>

    <!-- All categories view (no category_id selected) -->
    <div v-else-if="!categoryId" class="space-y-6">
      <div class="mb-8">
        <h1
          class="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent mb-2"
        >
          {{ t('categories.all') }}
        </h1>
        <p class="text-gray-500 dark:text-gray-400">
          {{ t('categories.countLabel', { count: categories?.length || 0 }) }}
        </p>
      </div>

      <div
        v-if="categories?.length"
        class="flex flex-wrap gap-3"
      >
        <NuxtLink
          v-for="category in categories"
          :key="category.id"
          :to="{ query: { category_id: String(category.id) } }"
          class="px-5 py-2.5 bg-gradient-to-r from-purple-500 to-indigo-500 text-white rounded-xl text-sm font-medium hover:from-purple-600 hover:to-indigo-600 transition-all shadow-md hover:shadow-lg"
        >
          {{ category.name }} <span class="opacity-80 text-xs">({{ category.post_count ?? 0 }})</span>
        </NuxtLink>
      </div>

      <div
        v-else
        class="text-center py-12 text-gray-500"
      >
        {{ t('categories.empty') }}
      </div>
    </div>

    <!-- Category posts view (category_id selected) -->
    <div v-else>
      <div class="mb-8">
        <NuxtLink
          to="/categories"
          class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-purple-600 transition-colors mb-4"
        >
          <Icon icon="lucide:arrow-left" class="w-4 h-4" />
          {{ t('categories.backToAll') }}
        </NuxtLink>
        <h1 class="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent">
          {{ t('categories.categoryPosts') }}
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
            class="text-xl font-bold hover:text-purple-600"
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
              {{ new Date(post.created_at).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US") }}
            </span>
            <span>{{ t('categories.views', { count: post.views }) }}</span>
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
                ? 'bg-purple-600 text-white'
                : 'border hover:bg-gray-50',
            ]"
            @click="navigateTo({ query: { category_id: String(categoryId), page: pg } })"
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
        {{ t('categories.postsEmpty') }}
      </div>
    </div>
  </div>
</template>
