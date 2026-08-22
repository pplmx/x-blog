<script setup lang="ts">
import { computed } from "vue";
import { type PostListResponse, useApi, useCategories } from "~~/composables/useApi";
import { paginationPages } from "~~/composables/usePagination";
import { usePushSubscription } from "~~/composables/usePushSubscription";
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

// Windowed, ellipsis-aware pagination buttons (RIL TASK-083, ISS-052).
const paginationTokens = computed(() =>
	paginationPages(posts.value?.pagination?.total_pages ?? 0, posts.value?.pagination?.page ?? 1),
);

// Look up the category name for SEO when a category is selected
const categoryName = computed(() =>
	categoryId.value ? categories.value?.find((c) => c.id === categoryId.value)?.name : undefined,
);

// SEO: set dynamic head metadata based on view state. Passed as a getter so
// SPA navigation between ?category_id=X values updates the <title> (RIL
// TASK-080; useSeo accepts () => SeoOptions).
useSeo(() => ({
	title: categoryName.value
		? t("categories.categoryTitle", { name: categoryName.value })
		: t("categories.all"),
	description: categoryName.value
		? t("categories.categoryDesc", { name: categoryName.value })
		: t("categories.allDesc"),
	path: "/categories",
}));

// Scoped RSS feed (DEC-074, TASK-146): on a selected category, autodiscovery
// emits <link rel="alternate" type="application/rss+xml"> so browsers/feed
// readers offer "subscribe to this category", and the visible button shares
// the same feed URL.
// Scoped RSS feed (DEC-130/TASK-177): use the stable per-category feed URL
// (category has no slug — unique name is the path segment) when a category is
// selected; fall back to the global feed on the all-categories view.
const feedUrl = computed(() =>
	categoryName.value
		? `/rss/category/${encodeURIComponent(categoryName.value)}.xml`
		: "/rss/feed.xml",
);
useHead(() => ({
	link: categoryId.value
		? [
				{
					rel: "alternate",
					type: "application/rss+xml",
					title: t("categories.subscribe"),
					href: feedUrl.value,
				},
			]
		: [],
}));

// New-post push follow on this category (DEC-076, TASK-147): a one-tap way to
// be notified when the author publishes here. Shares the header push state.
const {
	status: pushStatus,
	init: initPush,
	subscribe: pushSubscribe,
	setNewPostPrefs,
	newPostPrefs,
} = usePushSubscription();
onMounted(() => initPush());
const pushVisible = computed(
	() => pushStatus.value !== "unsupported" && pushStatus.value !== "unconfigured",
);
const pushBusy = computed(
	() => pushStatus.value === "subscribing" || pushStatus.value === "unsubscribing",
);
const followingThisCategory = computed(
	() => newPostPrefs.value.want && newPostPrefs.value.categoryId === categoryId.value,
);

async function toggleFollowNewPosts() {
	if (!categoryId.value || pushBusy.value) return;
	if (followingThisCategory.value) {
		await setNewPostPrefs({ want: false, categoryId: null });
	} else if (pushStatus.value === "subscribed") {
		// Already subscribed (perhaps following all, or replies only) — upsert
		// the follow for this category without re-asking permission.
		await setNewPostPrefs({ want: true, categoryId: categoryId.value });
	} else {
		await pushSubscribe({ want: true, categoryId: categoryId.value });
	}
}

const followIcon = computed(() =>
	followingThisCategory.value ? "lucide:bell-ring" : "lucide:bell",
);
</script>

<template>
  <div class="max-w-5xl mx-auto">
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
        <div class="flex items-center justify-between gap-4">
          <h1 class="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent">
            {{ t('categories.categoryPosts') }}
          </h1>
          <div class="flex items-center gap-2">
            <button
              v-if="pushVisible"
              type="button"
              :disabled="pushBusy"
              :title="t('categories.followPushTitle')"
              class="inline-flex items-center gap-1.5 text-sm text-purple-600 hover:text-purple-700 border border-purple-200 hover:border-purple-300 rounded-full px-3 py-1.5 transition-colors whitespace-nowrap disabled:opacity-60"
              @click="toggleFollowNewPosts"
            >
              <Icon :icon="followIcon" class="w-4 h-4" :class="{ 'animate-pulse': pushBusy }" />
              {{ followingThisCategory ? t('categories.followingPush') : t('categories.followPush') }}
            </button>
            <a
              :href="feedUrl"
              target="_blank"
              rel="noopener"
              :title="t('categories.subscribeTitle')"
              class="inline-flex items-center gap-1.5 text-sm text-purple-600 hover:text-purple-700 border border-purple-200 hover:border-purple-300 rounded-full px-3 py-1.5 transition-colors whitespace-nowrap"
            >
              <Icon icon="lucide:rss" class="w-4 h-4" />
              {{ t('categories.subscribe') }}
            </a>
          </div>
        </div>
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

        <!-- Pagination (windowed with ellipsis, RIL TASK-083) -->
        <div
          v-if="posts.pagination.total_pages > 1"
          class="flex justify-center gap-2 mt-8"
        >
          <button
            v-for="(pg, i) in paginationTokens"
            :key="pg === '…' ? `ellipsis-${i}` : pg"
            :disabled="pg === '…'"
            :class="[
              'px-3 py-1 rounded',
              pg === '…'
                ? 'cursor-default text-gray-400'
                : pg === posts.pagination.page
                  ? 'bg-purple-600 text-white'
                  : 'border hover:bg-gray-50',
            ]"
            @click="pg !== '…' && navigateTo({ query: { category_id: categoryId ? String(categoryId) : undefined, page: pg } })"
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
