<script setup lang="ts">
import { computed, watch } from "vue";
import { useAuthorPosts } from "~~/api/public/authors";
import { scrollToPageTop } from "~~/composables/scrollToTop";
import { paginationPages } from "~~/composables/usePagination";
import { useSeo } from "~~/composables/useSeo";

const { t } = useLang();
const route = useRoute();

// The author id comes from the path (/authors/{id}). Keep it reactive so SPA
// navigation between authors refetches (mirrors the posts/[slug] getter
// pattern, TASK-090); an id that is not a number is never a public author.
const authorId = computed(() => {
	const id = Number.parseInt(String(route.params.id), 10);
	return Number.isFinite(id) ? id : undefined;
});

const page = computed(() => (route.query.page ? Number.parseInt(String(route.query.page), 10) : 1));

// Page 1 leaves the query param off (withQuery omits undefined values) so the
// canonical URL has no trailing ?page=1.
const filters = computed(() => ({
	page: page.value > 1 ? page.value : undefined,
}));

// Fetching a getter that resolves to undefined makes useFetch skip the request
// entirely — an invalid (non-numeric) id renders the not-found view below
// without ever hitting the API (the backend would 422, not 404, on a
// non-integer path id).
const {
	data: archive,
	pending,
	error,
	refresh: refreshArchive,
} = await useAuthorPosts(() => (authorId.value ? authorId.value : null), filters);

function retry() {
	void refreshArchive();
}

// The archive envelope (DEC-359/TASK-405) identifies the author by pen name —
// available even when the writer has no published posts yet, so the page can
// title itself correctly for an empty-but-public author.
const authorName = computed(() => archive.value?.author?.display_name ?? "");

useSeo(() => ({
	title: authorName.value ? t("authors.title", { name: authorName.value }) : t("authors.seoTitle"),
	description: authorName.value
		? t("authors.desc", { name: authorName.value })
		: t("authors.seoDesc"),
	path: `/authors/${authorId.value ?? ""}`,
}));

// Scoped RSS feed (round 345): subscribe to just this writer's published
// posts — the same autodiscovery pattern series/tags pages use (DEC-130). The
// backend answers 404 for unknown/never-public authors, mirroring the archive.
const feedUrl = computed(() => (authorName.value ? `/rss/authors/${authorId.value}.xml` : ""));
useHead(() => ({
	link: feedUrl.value
		? [
				{
					rel: "alternate",
					type: "application/rss+xml",
					title: t("authors.subscribeFeed"),
					href: feedUrl.value,
				},
			]
		: [],
}));

const paginationTokens = computed(() =>
	paginationPages(
		archive.value?.pagination?.total_pages ?? 0,
		archive.value?.pagination?.page ?? 1,
	),
);

// Paging swaps the list in place; return the reader to the top so the new page
// is visible above the fold (same behaviour the home feed established).
function goToPage(pg: number | string) {
	navigateTo({ query: { page: pg } });
	scrollToPageTop();
}

// A stale/out-of-range page deep link would otherwise render "No posts yet"
// with no way back — clamp to the last real page once pagination is known
// (same guard home/search/archive/tags use, deep-dive finding ISS-308).
watch(
	() => archive.value?.pagination,
	(p) => {
		const requested = Number.parseInt(String(route.query.page), 10);
		if (!p || Number.isNaN(requested) || requested < 2) return;
		const last = p.total_pages ?? 1;
		if (requested > last && last >= 1) {
			navigateTo({ query: { page: String(last) }, replace: true });
		}
	},
);
</script>

<template>
  <div class="max-w-5xl mx-auto">
    <!-- Loading skeleton -->
    <div v-if="pending" class="space-y-4" role="status" aria-busy="true">
      <div class="bg-gray-100 dark:bg-gray-800 animate-pulse h-8 rounded-lg mb-4 w-1/3" />
      <div v-for="i in 3" :key="i" class="rounded-2xl border border-gray-100 dark:border-gray-800 p-6 space-y-3">
        <div class="h-5 bg-gray-200 dark:bg-gray-800 rounded w-3/4 animate-pulse" />
        <div class="h-3 bg-gray-200 dark:bg-gray-800 rounded w-1/4 animate-pulse" />
      </div>
    </div>

    <!-- A real 404 (unknown or never-public author: the byline link outlives a
         pen name that the superuser later cleared, or a hand-typed id): the
         friendly not-found state, not "load failed" + a Retry that can never
         succeed. Mirrors posts/[slug]. -->
    <div v-else-if="(error && error.statusCode === 404) || !authorId" class="text-center py-20 text-gray-500">
      <Icon icon="lucide:file-question" class="w-12 h-12 mx-auto mb-4 text-gray-300" />
      <p class="mb-4">{{ t("authors.notFound") }}</p>
      <NuxtLink to="/" class="px-4 py-2 rounded-lg text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline">
        {{ t("common.action.backHome") }}
      </NuxtLink>
    </div>

    <!-- Load error (network/5xx): a way onward instead of a dead end. -->
    <div v-else-if="error" class="text-center py-20 text-gray-500" role="alert">
      <Icon icon="lucide:alert-circle" class="w-12 h-12 mx-auto mb-4 text-gray-300" />
      <p class="mb-4">{{ t("common.state.loadFailed") }}</p>
      <div class="flex items-center justify-center gap-3">
        <button
          type="button"
          class="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          @click="retry"
        >
          {{ t("common.action.retry") }}
        </button>
        <NuxtLink to="/" class="px-4 py-2 rounded-lg text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline">
          {{ t("common.action.backHome") }}
        </NuxtLink>
      </div>
    </div>

    <div v-else class="space-y-6">
      <!-- Author header (DEC-359/TASK-405): "Posts by {pen name}". The name
           comes from the archive envelope, so it renders even when the writer
           has published nothing yet. -->
      <div class="mb-4">
        <h1
          class="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent mb-2 flex items-center gap-3"
        >
          <Icon icon="lucide:user" class="w-8 h-8 text-gray-400" />
          {{ t("authors.title", { name: authorName }) }}
        </h1>
        <div class="flex items-center gap-3">
          <p class="text-gray-500 dark:text-gray-400">
            {{ t("authors.desc", { name: authorName }) }}
          </p>
          <a
            v-if="feedUrl"
            :href="feedUrl"
            target="_blank"
            rel="noopener"
            :title="t('authors.subscribeFeed')"
            class="inline-flex items-center gap-1 text-orange-500 hover:text-orange-700 dark:hover:text-orange-400 transition-colors shrink-0"
          >
            <Icon icon="lucide:rss" class="w-4 h-4" />
            {{ t("authors.subscribeFeed") }}
          </a>
        </div>
      </div>

      <div v-if="archive?.items?.length" class="space-y-5">
        <PostCard v-for="post in archive.items" :key="post.id" :post="post" />

        <!-- Pagination (windowed with ellipsis, RIL TASK-083) -->
        <div
          v-if="archive.pagination.total_pages > 1"
          class="flex items-center justify-center gap-2 mt-8"
        >
          <button
            v-for="(pg, i) in paginationTokens"
            :key="pg === '…' ? `ellipsis-${i}` : pg"
            :disabled="pg === '…' || pg === archive.pagination.page"
            :aria-current="pg !== '…' && pg === archive.pagination.page ? 'page' : undefined"
            :class="[
              'w-9 h-9 rounded-xl text-sm font-medium transition-all duration-200',
              pg === '…'
                ? 'cursor-default text-gray-400 dark:text-gray-500'
                : pg === archive.pagination.page
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20 cursor-default'
                  : 'border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800',
            ]"
            @click="pg !== '…' && pg !== archive.pagination.page && goToPage(pg)"
          >
            {{ pg }}
          </button>
        </div>
      </div>

      <!-- An empty-but-public author (has a pen name, nothing published yet):
           distinct from the not-found state above. -->
      <div v-else class="text-center py-16 text-gray-500">
        <Icon icon="lucide:file-text" class="w-12 h-12 mx-auto mb-3 text-gray-300" />
        <p>{{ t("authors.postsEmpty") }}</p>
      </div>
    </div>
  </div>
</template>
