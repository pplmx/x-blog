<script setup lang="ts">
import { computed } from "vue";
import { usePage } from "~~/api/public/pages";
import { formatPostDate } from "~~/composables/apiDate";
import { useSeo } from "~~/composables/useSeo";

const { t, locale } = useLang();
const route = useRoute();

// The slug comes from the path (/pages/{slug}); keep it reactive so SPA
// navigation between pages refetches (mirrors the posts/[slug] getter pattern,
//). A null slug is never a real page.
const slug = computed(() => {
	const raw = String(route.params.slug ?? "");
	return raw === "" || raw === "undefined" ? null : raw;
});

const {
	data: page,
	pending,
	error,
	refresh: refreshPage,
} = await usePage(() => (slug.value ? slug.value : null));

const slugRedirect = useSlugRedirect(error.value);

function retry() {
	void refreshPage();
}

// "Last updated" date for the public page (naive-UTC wire contract,
// site-wide long form — same format as PostCard/article/bookmarks).
const updatedLabel = computed(() => formatPostDate(page.value?.updated_at, locale.value));

useSeo(() => ({
	title: page.value?.title ?? t("pages.seoTitle"),
	description: t("pages.seoDesc"),
	path: `/pages/${slug.value ?? ""}`,
	locale: locale.value,
}));

// A deleted/unknown slug must answer 404, not 200 with an in-page notice —
// soft 404s get indexed. Only SSR can write the status.
const pageMissing = computed(
	() =>
		!pending.value &&
		(error.value?.statusCode === 404 || !slug.value || (!error.value && !page.value)),
);
// A re-slugged page already emitted its 301; writing 404 here would clobber it.
if (import.meta.server && pageMissing.value && !slugRedirect) {
	setResponseStatus(404);
}
useHead(() =>
	pageMissing.value
		? {
				title: t("pages.notFound"),
				meta: [{ name: "robots", content: "noindex" }],
			}
		: {},
);
</script>

<template>
	<div class="max-w-3xl mx-auto">
		<!-- Loading skeleton -->
		<div v-if="pending" class="space-y-4" role="status" aria-busy="true">
			<div class="bg-gray-100 dark:bg-gray-800 animate-pulse h-8 rounded-lg mb-4 w-1/2" />
			<div class="bg-gray-100 dark:bg-gray-800 animate-pulse h-4 rounded w-full" />
			<div class="bg-gray-100 dark:bg-gray-800 animate-pulse h-4 rounded w-5/6" />
			<div class="bg-gray-100 dark:bg-gray-800 animate-pulse h-4 rounded w-2/3" />
		</div>

		<!-- A real 404 (unpublished or unknown slug — the public surface is
         no-oracle, so a draft is indistinguishable from never-published). -->
		<div
			v-else-if="(error && error.statusCode === 404) || !slug"
			class="text-center py-20 text-gray-500"
		>
			<Icon icon="lucide:file-question" class="w-12 h-12 mx-auto mb-4 text-gray-300" />
			<h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">
				{{ t("pages.notFound") }}
			</h1>
			<NuxtLink
				to="/"
				class="px-4 py-2 rounded-lg text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
			>
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
				<NuxtLink
					to="/"
					class="px-4 py-2 rounded-lg text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
				>
					{{ t("common.action.backHome") }}
				</NuxtLink>
			</div>
		</div>

		<article v-else>
			<h1
				class="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent mb-3"
			>
				{{ page?.title }}
			</h1>
			<p v-if="updatedLabel" class="text-sm text-gray-500 dark:text-gray-400 mb-8">
				{{ t("pages.updatedAt", { date: updatedLabel }) }}
			</p>
			<!-- Page bodies go through the same markdown pipeline as posts, so
           code/math/mermaid/images all render consistently. -->
			<MarkdownContent :content="page?.content ?? ''" />
		</article>
	</div>
</template>
