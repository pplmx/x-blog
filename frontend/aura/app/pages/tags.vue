<script setup lang="ts">
import { computed, onMounted } from "vue";
import { usePosts } from "~~/api/public/posts";
import { useTags } from "~~/api/public/taxonomy";
import {
	followReaderTag,
	setTagFollowNotify,
	unfollowReaderTag,
	useReaderTagFollows,
} from "~~/api/reader/follows";
import { paginationPages } from "~~/composables/usePagination";
import { useSeo } from "~~/composables/useSeo";

const { t, locale } = useLang();
const route = useRoute();
// Reactive sources so SPA navigation that changes only query params
// (tag_id / page) refetches — the computed URL drives useFetch.
const tagId = computed(() =>
	route.query.tag_id ? Number.parseInt(String(route.query.tag_id), 10) : undefined,
);
const page = computed(() => (route.query.page ? Number.parseInt(String(route.query.page), 10) : 1));

// `withQuery` omits undefined values, so page 1 or an unset tag leaves no
// trailing query params behind (matches the previous URL construction).
const postsFilters = computed(() => ({
	tag_id: tagId.value,
	page: page.value > 1 ? page.value : undefined,
}));

const { data: tags, pending: tagsPending } = await useTags();
const { data: posts, pending: postsPending } = await usePosts(postsFilters);
const pending = computed(() => tagsPending.value || postsPending.value);

// Windowed, ellipsis-aware pagination buttons (RIL TASK-083, ISS-052).
const paginationTokens = computed(() =>
	paginationPages(posts.value?.pagination?.total_pages ?? 0, posts.value?.pagination?.page ?? 1),
);

// Look up the tag name for SEO when a tag is selected
const tagName = computed(() =>
	tagId.value ? tags.value?.find((t) => t.id === tagId.value)?.name : undefined,
);

// SEO: set dynamic head metadata based on view state. Passed as a getter so
// SPA navigation between ?tag_id=X values updates the <title> without a reload
// (RIL TASK-080; useSeo accepts () => SeoOptions).
useSeo(() => ({
	title: tagName.value ? t("tags.tagTitle", { name: tagName.value }) : t("tags.all"),
	description: tagName.value ? t("tags.tagDesc", { name: tagName.value }) : t("tags.allDesc"),
	path: "/tags",
}));

// Scoped RSS feed (DEC-074, TASK-146): on a selected tag, autodiscovery emits
// <link rel="alternate" type="application/rss+xml"> and the visible button
// shares the tag-scoped feed URL.
const feedUrl = computed(() =>
	tagId.value ? `/rss/feed.xml?tag_id=${tagId.value}` : "/rss/feed.xml",
);
useHead(() => ({
	link: tagId.value
		? [
				{
					rel: "alternate",
					type: "application/rss+xml",
					title: t("tags.subscribe"),
					href: feedUrl.value,
				},
			]
		: [],
}));

// Durable reader-level tag follow (DEC-195/TASK-215): a signed-in reader can
// follow a tag (persisted, cross-device) — tags are the fine-grained axis
// categories are too coarse for — and manage + toggle notifications on the
// account page. Mirrors the category-follow interaction on categories.vue.
const tagSignedIn = computed(
	() =>
		typeof window !== "undefined" &&
		typeof localStorage?.getItem === "function" &&
		!!localStorage.getItem("reader_token"),
);
const tagFollowing = ref(false);
const tagNotify = ref(true);
const tagFollowBusy = ref(false);

async function loadTagFollow() {
	if (!tagSignedIn.value || !tagId.value) return;
	try {
		const res = await useReaderTagFollows();
		const item = res.data?.value?.items.find((t) => t.id === tagId.value) ?? null;
		tagFollowing.value = !!item;
		tagNotify.value = item?.notify ?? true;
	} catch {
		tagFollowing.value = false;
		tagNotify.value = true;
	}
}

async function toggleTagFollow() {
	if (tagFollowBusy.value || !tagId.value) return;
	tagFollowBusy.value = true;
	try {
		if (tagFollowing.value) {
			await unfollowReaderTag(tagId.value);
			tagFollowing.value = false;
		} else {
			const res = await followReaderTag(tagId.value);
			tagFollowing.value = true;
			tagNotify.value = res?.notify ?? true;
		}
	} catch {
		// best-effort — keep current state on failure
	} finally {
		tagFollowBusy.value = false;
	}
}

async function toggleTagNotify() {
	if (tagFollowBusy.value || !tagId.value || !tagFollowing.value) return;
	tagFollowBusy.value = true;
	const next = !tagNotify.value;
	try {
		const res = await setTagFollowNotify(tagId.value, next);
		tagNotify.value = res?.notify ?? next;
	} catch {
		// best-effort — keep current state on failure
	} finally {
		tagFollowBusy.value = false;
	}
}

onMounted(loadTagFollow);
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

    <!-- All tags view (no tag_id selected) -->
    <div v-else-if="!tagId" class="space-y-6">
      <div class="mb-8">
        <h1
          class="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent mb-2"
        >
          {{ t('tags.all') }}
        </h1>
        <p class="text-gray-500 dark:text-gray-400">
          {{ t('tags.countLabel', { count: tags?.length || 0 }) }}
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
          #{{ tag.name }} <span class="opacity-80 text-xs">({{ tag.post_count ?? 0 }})</span>
        </NuxtLink>
      </div>

      <div
        v-else
        class="text-center py-12 text-gray-500"
      >
        {{ t('tags.empty') }}
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
          {{ t('tags.backToAll') }}
        </NuxtLink>
        <div class="flex items-center justify-between gap-4">
          <h1 class="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent">
            {{ t('tags.tagPosts') }}
          </h1>
          <div class="flex items-center gap-2">
            <button
              v-if="tagSignedIn"
              type="button"
              :disabled="tagFollowBusy"
              :title="t(tagFollowing ? 'tags.followingTitle' : 'tags.followTitle')"
              class="inline-flex items-center gap-1.5 text-sm text-emerald-600 hover:text-emerald-700 border border-emerald-200 hover:border-emerald-300 rounded-full px-3 py-1.5 transition-colors whitespace-nowrap disabled:opacity-60"
              @click="toggleTagFollow"
            >
              <Icon :icon="tagFollowing ? 'lucide:bookmark-check' : 'lucide:bookmark'" class="w-4 h-4" />
              {{ tagFollowing ? t('tags.following') : t('tags.follow') }}
            </button>
            <button
              v-if="tagFollowing"
              type="button"
              :disabled="tagFollowBusy"
              :title="t('tags.notifyTitle')"
              class="inline-flex items-center gap-1.5 text-sm text-emerald-600 hover:text-emerald-700 border border-emerald-200 hover:border-emerald-300 rounded-full px-3 py-1.5 transition-colors whitespace-nowrap disabled:opacity-60"
              @click="toggleTagNotify"
            >
              <Icon :icon="tagNotify ? 'lucide:bell' : 'lucide:bell-off'" class="w-4 h-4" />
              {{ t(tagNotify ? 'tags.notifyOn' : 'tags.notifyOff') }}
            </button>
            <a
              :href="feedUrl"
              target="_blank"
              rel="noopener"
              :title="t('tags.subscribeTitle')"
              class="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-300 rounded-full px-3 py-1.5 transition-colors whitespace-nowrap"
            >
              <Icon icon="lucide:rss" class="w-4 h-4" />
              {{ t('tags.subscribe') }}
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
              {{ new Date(post.created_at).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US") }}
            </span>
            <span>{{ t('tags.views', { count: post.views }) }}</span>
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
                  ? 'bg-blue-600 text-white'
                  : 'border hover:bg-gray-50',
            ]"
            @click="pg !== '…' && navigateTo({ query: { tag_id: tagId ? String(tagId) : undefined, page: pg } })"
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
        {{ t('tags.postsEmpty') }}
      </div>
    </div>
  </div>
</template>
