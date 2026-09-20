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
import { computed, onMounted } from "vue";
import type { PaginationInfo } from "~~/api/contracts/shared";
import { type DiscussionFeedItem, useDiscussionFeed } from "~~/api/public/comments";
// biome-ignore lint/correctness/noUnusedImports: used from the template — biome cannot resolve Vue script-setup template bindings (vue-tsc verifies).
import { parseApiDate } from "~~/composables/apiDate";
import { scrollToPageTop } from "~~/composables/scrollToTop";
import { useBlockedReaderIds } from "~~/composables/useBlockedReaderIds";
import { paginationPages } from "~~/composables/usePagination";
import { useSeo } from "~~/composables/useSeo";
import { commentAuthorName } from "~~/utils/commentAuthorName";

const { t, locale } = useLang();
const route = useRoute();

useSeo(() => ({
	title: t("discussion.seo.title"),
	description: t("discussion.seo.description"),
	path: page.value > 1 ? `/discussion?page=${page.value}` : "/discussion",
	locale: locale.value,
	pagination: {
		page: page.value || 1,
		totalPages: feed.value?.pagination?.total_pages ?? 1,
		pagePath: (pg) => (pg > 1 ? `/discussion?page=${pg}` : "/discussion"),
	},
}));

// Feed auto-discovery for the discussion (round 368, DEC-409): the RSS/Atom
// feeds of the latest approved comments, so a feed-reader / "subscribe" flow
// on this page finds the right subscriptions (same pattern as app.vue's
// post-feed discovery).
useHead({
	link: [
		{
			rel: "alternate",
			type: "application/rss+xml",
			title: "Discussion RSS",
			href: "/rss/comments.xml",
		},
		{
			rel: "alternate",
			type: "application/atom+xml",
			title: "Discussion Atom",
			href: "/rss/comments.atom.xml",
		},
	],
});

// TASK-478/ISS-554: clamp an invalid ?page= (non-numeric, zero, negative) to
// page 1 at the computed — the feed request must never carry NaN/0 (guaranteed
// 422), and the out-of-range clamp watcher below short-circuits NaN/<2, so
// without this an invalid deep link would brick the page with a dead Retry.
// Same pattern as follows.vue/liked.vue.
const page = computed(() => {
	const raw = route.query.page ? Number.parseInt(String(route.query.page), 10) : 1;
	return Number.isNaN(raw) || raw < 1 ? 1 : raw;
});

const { data: feed, pending, error, refresh: refreshFeed } = await useDiscussionFeed(page, 20);
// Blocked-reader suppression (round 386, DEC-437): the feed is public, but a
// signed-in viewer's own block list (a receiver-side opt-out, DEC-425) should
// hide the blocked readers' cards. Loads asynchronously; the feed first paints
// unadulterated and then filters once the list lands.
const { blockedReaderIds, loadBlockedReaderIds } = useBlockedReaderIds();
onMounted(() => {
	void loadBlockedReaderIds();
});
const feedItems = computed<DiscussionFeedItem[]>(() =>
	(feed.value?.items ?? []).filter(
		(item) => !item.reader || !blockedReaderIds.value.has(item.reader.id),
	),
);
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

// Screen-reader page announcement (round 397, same pattern as home): pagination
// swaps the feed in place, which is invisible to assistive tech — announce the
// landed page when it changes.
const pageAnnouncement = computed(() => t("common.state.pageAnnounce", { page: page.value }));
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
			<!-- Subscribe to the discussion stream (round 368, DEC-409): the
			     RSS/Atom feeds surface here so a reader can follow the
			     conversation in their feed reader, matching the discovery
			     links the post feeds get. -->
			<a
				href="/rss/comments.xml"
				type="application/rss+xml"
				class="inline-flex items-center gap-1.5 mt-3 text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
				:title="t('discussion.subscribe')"
			>
				<Icon icon="lucide:rss" class="w-4 h-4" />
				{{ t("discussion.subscribe") }}
			</a>
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
			v-else-if="!feed || !feedItems.length"
			class="flex flex-col items-center justify-center py-16 rounded-2xl border border-gray-100 dark:border-gray-800"
		>
			<Icon icon="lucide:messages-square" class="w-10 h-10 text-gray-300 dark:text-gray-600 mb-4" />
			<p class="text-gray-700 dark:text-gray-300 font-medium">{{ t("discussion.empty") }}</p>
			<p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t("discussion.emptyHint") }}</p>
		</div>

		<!-- Feed -->
		<div v-else class="space-y-4">
			<span role="status" aria-live="polite" class="sr-only">{{ pageAnnouncement }}</span>
			<div
				v-for="item in feedItems"
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
						{{ commentAuthorName(item, t("components.commentList.readerNoName")) }}
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
					:disabled="pg === '…' || pg === page"
					:aria-current="pg !== '…' && pg === page ? 'page' : undefined"
					:class="[
						'px-3 py-1 rounded',
						pg === '…'
							? 'cursor-default text-gray-400'
							: pg === page
								? 'bg-blue-600 text-white cursor-default'
								: 'border hover:bg-gray-50',
					]"
					@click="pg !== '…' && pg !== page && goToPage(pg)"
				>
					{{ pg }}
				</button>
			</div>
		</div>
	</div>
</template>
