<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { usePosts } from "~~/api/public/posts";
import { useCategories } from "~~/api/public/taxonomy";
import {
	followReaderCategory,
	getReaderCategoryFollows,
	setCategoryFollowNotify,
	unfollowReaderCategory,
} from "~~/api/reader/follows";
// biome-ignore lint/correctness/noUnusedImports: used from the template — biome cannot resolve Vue script-setup template bindings (vue-tsc verifies).
import { effectivePublishTs, parseApiDate } from "~~/composables/apiDate";
import { scrollToPageTop } from "~~/composables/scrollToTop";
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

// `withQuery` omits undefined values, so page 1 or an unset category leaves no
// trailing query params behind (matches the previous URL construction).
const postsFilters = computed(() => ({
	category_id: categoryId.value,
	page: page.value > 1 ? page.value : undefined,
}));

const {
	data: categories,
	pending: categoriesPending,
	error: categoriesError,
	refresh: refreshCategories,
} = await useCategories();
const {
	data: posts,
	pending: postsPending,
	error: postsError,
	refresh: refreshPosts,
} = await usePosts(postsFilters);
const pending = computed(() => categoriesPending.value || postsPending.value);
// A failed fetch must NOT fall through to the empty state and be mistaken for
// "this category simply has no posts" — surface it as an error with a retry.
const error = computed(() => categoriesError.value || postsError.value);
function retry() {
	void refreshCategories();
	void refreshPosts();
}

// Paging from the bottom of the list swaps it in place; return the reader to
// the top so the new page is visible above the fold (same behaviour the home
// feed established for its pagination).
function goToPage(pg: number | string) {
	navigateTo({
		query: { category_id: categoryId.value ? String(categoryId.value) : undefined, page: pg },
	});
	scrollToPageTop();
}

// Windowed, ellipsis-aware pagination buttons (RIL TASK-083, ISS-052).
const paginationTokens = computed(() =>
	paginationPages(posts.value?.pagination?.total_pages ?? 0, posts.value?.pagination?.page ?? 1),
);

// A stale/out-of-range page deep link (e.g. /categories?category_id=2&page=999
// after posts were deleted) would otherwise render "No posts yet" with the
// pagination bar hidden and no way back — clamp to the last real page once
// pagination is known (home/search already do this; deep-dive finding
// ISS-308). Loop-safe: the clamp target is valid by construction.
watch(
	() => posts.value?.pagination,
	(p) => {
		const requested = Number.parseInt(String(route.query.page), 10);
		if (!p || Number.isNaN(requested) || requested < 2) return;
		const last = p.total_pages ?? 1;
		if (requested > last && last >= 1 && categoryId.value) {
			navigateTo({
				query: { category_id: String(categoryId.value), page: String(last) },
				replace: true,
			});
		}
	},
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
	try {
		if (followingThisCategory.value) {
			await setNewPostPrefs({ want: false, categoryId: null });
		} else if (pushStatus.value === "subscribed") {
			// Already subscribed (perhaps following all, or replies only) — upsert
			// the follow for this category without re-asking permission.
			await setNewPostPrefs({ want: true, categoryId: categoryId.value });
		} else {
			await pushSubscribe({ want: true, categoryId: categoryId.value });
		}
	} catch {
		// Transient push/network failure: the composable reverts to a retryable
		// state, so a later tap retries. Never let a click handler reject
		// unhandled (the composable rethrows so the initiating caller decides
		// feedback — deep-dive finding, surface it rather than staying silent).
		noteFollowError();
	}
}

const followIcon = computed(() =>
	followingThisCategory.value ? "lucide:bell-ring" : "lucide:bell",
);

// Durable reader-level category follow (DEC-140/TASK-182): a signed-in reader
// can follow a category (persisted, cross-device) distinct from the per-device
// new-post pin above, and manage + toggle notifications on the account page.
const catSignedIn = computed(
	() =>
		typeof window !== "undefined" &&
		typeof localStorage?.getItem === "function" &&
		!!localStorage.getItem("reader_token"),
);
const catFollowing = ref(false);
const catNotify = ref(true);
const catFollowBusy = ref(false);
// Follow/notify toggle failures surface here (deep-dive finding): the previous
// empty catch blocks made an offline/429/500 tap a silent no-op.
const followError = ref(false);
let followErrorTimer: ReturnType<typeof setTimeout> | undefined;
function noteFollowError() {
	if (followErrorTimer) clearTimeout(followErrorTimer);
	followError.value = true;
	followErrorTimer = setTimeout(() => {
		followError.value = false;
		followErrorTimer = undefined;
	}, 4000);
}

async function loadCategoryFollow() {
	if (!catSignedIn.value || !categoryId.value) return;
	try {
		// Imperative $fetch seam (ISS-110/111, TASK-199): useFetch-based query()
		// wrappers silently no-op when called from onMounted in a sync-setup
		// component — the same class of regression ISS-117 fixed on the account
		// page. Await the plain response directly.
		const res = await getReaderCategoryFollows();
		const item = res.items.find((c) => c.id === categoryId.value) ?? null;
		catFollowing.value = !!item;
		catNotify.value = item?.notify ?? true;
	} catch {
		catFollowing.value = false;
		catNotify.value = true;
	}
}

async function toggleCategoryFollow() {
	if (catFollowBusy.value || !categoryId.value) return;
	catFollowBusy.value = true;
	try {
		if (catFollowing.value) {
			await unfollowReaderCategory(categoryId.value);
			catFollowing.value = false;
		} else {
			const res = await followReaderCategory(categoryId.value);
			catFollowing.value = true;
			catNotify.value = res?.notify ?? true;
		}
	} catch {
		// best-effort — keep current state on failure, but say so (deep-dive
		// finding: a silent no-op was indistinguishable from "in progress").
		noteFollowError();
	} finally {
		catFollowBusy.value = false;
	}
}

async function toggleCategoryNotify() {
	if (catFollowBusy.value || !categoryId.value || !catFollowing.value) return;
	catFollowBusy.value = true;
	const next = !catNotify.value;
	try {
		const res = await setCategoryFollowNotify(categoryId.value, next);
		catNotify.value = res?.notify ?? next;
	} catch {
		// best-effort — keep current state on failure, but say so (deep-dive).
		noteFollowError();
	} finally {
		catFollowBusy.value = false;
	}
}

onMounted(loadCategoryFollow);
// SPA navigation between categories (query-only change: /categories →
// /categories?category_id=2) reuses this component instance, so onMounted does
// not re-fire — the follow/notify buttons would keep the PREVIOUS category's
// state (and a "follow" click would double-follow). Re-load whenever the
// active category changes even on the same mount (deep-dive finding).
watch(categoryId, () => {
	catFollowing.value = false;
	catNotify.value = true;
	void loadCategoryFollow();
});
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

    <!-- Load failed — distinct from "empty": never tell the reader the category
         has nothing when we simply couldn't load it. -->
    <div v-else-if="error" class="text-center py-12">
      <p class="text-gray-500 dark:text-gray-400 mb-4">{{ t('common.state.loadFailed') }}</p>
      <button
        type="button"
        class="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        @click="retry"
      >
        {{ t('common.action.retry') }}
      </button>
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
              v-if="catSignedIn"
              type="button"
              :disabled="catFollowBusy"
              :title="t(catFollowing ? 'categories.followingTitle' : 'categories.followTitle')"
              class="inline-flex items-center gap-1.5 text-sm text-emerald-600 hover:text-emerald-700 border border-emerald-200 hover:border-emerald-300 rounded-full px-3 py-1.5 transition-colors whitespace-nowrap disabled:opacity-60"
              @click="toggleCategoryFollow"
            >
              <Icon :icon="catFollowing ? 'lucide:bookmark-check' : 'lucide:bookmark'" class="w-4 h-4" />
              {{ catFollowing ? t('categories.following') : t('categories.follow') }}
            </button>
            <button
              v-if="catFollowing"
              type="button"
              :disabled="catFollowBusy"
              :title="t('categories.notifyTitle')"
              class="inline-flex items-center gap-1.5 text-sm text-emerald-600 hover:text-emerald-700 border border-emerald-200 hover:border-emerald-300 rounded-full px-3 py-1.5 transition-colors whitespace-nowrap disabled:opacity-60"
              @click="toggleCategoryNotify"
            >
              <Icon :icon="catNotify ? 'lucide:bell' : 'lucide:bell-off'" class="w-4 h-4" />
              {{ t(catNotify ? 'categories.notifyOn' : 'categories.notifyOff') }}
            </button>
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
        <!-- Follow/notify failure (deep-dive finding): never a silent no-op. -->
        <p v-if="followError" role="alert" class="mt-3 text-sm text-red-600 dark:text-red-400">
          {{ t('categories.followFailed') }}
        </p>
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
              {{ parseApiDate(effectivePublishTs(post))?.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US") ?? "" }}
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
            :disabled="pg === '…' || pg === posts.pagination.page"
            :aria-current="pg !== '…' && pg === posts.pagination.page ? 'page' : undefined"
            :class="[
              'px-3 py-1 rounded',
              pg === '…'
                ? 'cursor-default text-gray-400'
                : pg === posts.pagination.page
                  ? 'bg-purple-600 text-white cursor-default'
                  : 'border hover:bg-gray-50',
            ]"
            @click="pg !== '…' && pg !== posts.pagination.page && goToPage(pg)"
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
