<script setup lang="ts">
/**
 * Public discussion feed (round 367, DEC-407).
 *
 * Comment search (DEC-405) made the blog's thread FINDABLE; this page makes it
 * BROWSABLE — a visitor who wants to see what people are saying right now has
 * no surface otherwise. The newest approved comments on publicly-visible
 * posts, each card carrying the commenter identity, the snippet/excerpt of the
 * comment, and the post brief, deep-linking ONTO the exact comment
 * (`/posts/{slug}#comment-{id}`, DEC-321). Public, no auth, paginated.
 */
import { computed } from "vue";
import type { PaginationInfo } from "~~/api/contracts/shared";
import { useDiscussionFeed } from "~~/api/public/comments";
// biome-ignore lint/correctness/noUnusedImports: used from the template — biome cannot resolve Vue script-setup template bindings (vue-tsc verifies).
import { parseApiDate } from "~~/composables/apiDate";
import { scrollToPageTop } from "~~/composables/scrollToTop";
import { paginationPages } from "~~/composables/usePagination";
import { useSeo } from "~~/composables/useSeo";

const { t, locale } = useLang();
const route = useRoute();

useSeo(() => ({
	title: t("discussion.seo.title"),
	description: t("discussion.seo.description"),
	path: "/discussion",
}));

const page = computed(() => (route.query.page ? Number.parseInt(String(route.query.page), 10) : 1));

const { data: feed, pending, error, refresh: refreshFeed } = await useDiscussionFeed(page, 20);
function retry() {
	void refreshFeed();
}

// Page-clamp: an out-of-range deep link (?page=99) has an empty page but real
// total_pages — send the reader back to the last real page (home/archive/
// search pattern, ISS-308).
watch(
	() => feed.value?.pagination,
	(p: PaginationInfo | null | undefined) => {
		const requested = page.value;
		if (!p || Number.isNaN(requested) || requested < 2) return;
		const last = p.total_pages;
		if (last === 0) {
			// Empty feed: drop the page param entirely.
			void navigateTo({ query: {} }, { replace: true });
		} else if (requested > last) {
			void navigateTo({ query: { page: String(last) } }, { replace: true });
		}
	},
);

function goToPage(pg: number | string) {
	void navigateTo({ query: pg === 1 ? {} : { page: String(pg) } });
	scrollToPageTop();
}

const paginationTokens = computed(() =>
	paginationPages(feed.value?.pagination?.total_pages ?? 0, page.value),
);
</script>

<template>
	<div class="max-w-4xl mx-auto px-4 py-8 sm:py-12">
		<!-- Header -->
		<div class="mb-8">
			<h1
				class="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent"
			>
				{{ t("discussion.header") }}
			</h1>
			<p class="text-gray-500 dark:text-gray-400 mt-2">
				{{ t("discussion.subtitle") }}
			</p>
		</div>

		<!-- Loading -->
		<div v-if="pending" class="space-y-4" role="status" aria-busy="true">
			<div v-for="i in 4" :key="i" class="bg-gray-100 dark:bg-gray-800 animate-pulse h-24 rounded-xl" />
		</div>

		<!-- Load failure -->
		<div v-else-if="error" class="text-center py-16">
			<p class="text-gray-500 dark:text-gray-400 mb-4" role="alert">
				{{ t("discussion.loadFailed") }}
			</p>
			<button
				type="button"
				class="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
				@click="retry"
			>
				<Icon icon="lucide:refresh-cw" class="w-4 h-4" />
				{{ t("common.action.retry") }}
			</button>
		</div>

		<!-- Empty -->
		<div
			v-else-if="!feed?.items?.length"
			class="flex flex-col items-center justify-center py-16 rounded-2xl border border-gray-100 dark:border-gray-800"
		>
			<Icon icon="lucide:messages-square" class="w-10 h-10 text-gray-300 dark:text-gray-600 mb-4" />
			<p class="text-gray-700 dark:text-gray-300 font-medium">{{ t("discussion.empty") }}</p>
			<p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t("discussion.emptyHint") }}</p>
		</div>

		<!-- Feed -->
		<div v-else class="space-y-4">
			<div
				v-for="item in feed.items"
				:key="item.id"
				class="border border-gray-100 dark:border-gray-800 rounded-xl p-5 hover:shadow-md transition-shadow"
			>
				<NuxtLink
					:to="item.post ? `/posts/${item.post.slug}#comment-${item.id}` : '#'"
					class="block text-gray-800 dark:text-gray-200 line-clamp-4 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
				>
					{{ item.content }}
				</NuxtLink>
				<div class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-sm text-gray-500 dark:text-gray-400">
					<span class="inline-flex items-center gap-1">
						<Icon icon="lucide:user" class="w-3.5 h-3.5" aria-hidden="true" />
						{{ item.reader?.display_name ?? item.nickname }}
					</span>
					<span v-if="item.post">
						<Icon icon="lucide:file-text" class="w-3.5 h-3.5 inline-block mr-1" aria-hidden="true" />
						{{ item.post.title }}
					</span>
					<span>
						{{ parseApiDate(item.created_at)?.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US") ?? "" }}
					</span>
				</div>
			</div>

			<!-- Pagination (windowed with ellipsis, RIL TASK-083) -->
			<div
				v-if="feed.pagination.total_pages > 1"
				class="flex justify-center gap-2 mt-8"
			>
				<button
					v-for="(pg, i) in paginationTokens"
					:key="pg === '…' ? `ellipsis-${i}` : pg"
					:disabled="pg === '…' || pg === feed.pagination.page"
					:aria-current="pg !== '…' && pg === feed.pagination.page ? 'page' : undefined"
					:class="[
						'px-3 py-1 rounded',
						pg === '…'
							? 'cursor-default text-gray-400'
							: pg === feed.pagination.page
								? 'bg-blue-600 text-white cursor-default'
								: 'border hover:bg-gray-50',
					]"
					@click="pg !== '…' && pg !== feed.pagination.page && goToPage(pg)"
				>
					{{ pg }}
				</button>
			</div>
		</div>
	</div>
</template>
