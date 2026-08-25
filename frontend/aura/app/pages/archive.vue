<script setup lang="ts">
import { computed } from "vue";
import { type ArchiveEntry, usePostArchive, usePosts } from "~~/api/public/posts";
import { useSeo } from "~~/composables/useSeo";

const { t, locale } = useLang();
const route = useRoute();
// Reactive sources so SPA navigation that changes only query params
// (year / month / page) refetches — the computed URL drives useFetch.
const year = computed(() =>
	route.query.year ? Number.parseInt(String(route.query.year), 10) : undefined,
);
const month = computed(() =>
	route.query.month ? Number.parseInt(String(route.query.month), 10) : undefined,
);
const page = computed(() => (route.query.page ? Number.parseInt(String(route.query.page), 10) : 1));

// Only fetch posts when a year/month is actually selected (index view has no
// post list). `enabled: false` makes Nuxt skip the request without firing it.
const hasPeriod = computed(() => !!year.value || !!month.value);

// Year/month/page filters mirror the previous URL construction: `withQuery`
// omits undefined values, so page 1, an empty year, or an empty month leave no
// trailing query params behind.
const postsFilters = computed(() => ({
	year: year.value,
	month: month.value,
	page: page.value > 1 ? page.value : undefined,
}));

const { data: archive, pending: archivePending } = await usePostArchive();
const { data: posts, pending: postsPending } = await usePosts(postsFilters, { enabled: hasPeriod });
const pending = computed(() => archivePending.value || postsPending.value);

// Group flat (year, month, count) buckets into years, newest first.
const years = computed<{ year: number; months: ArchiveEntry[] }[]>(() => {
	const map = new Map<number, ArchiveEntry[]>();
	for (const entry of archive.value ?? []) {
		const list = map.get(entry.year) ?? [];
		list.push(entry);
		map.set(entry.year, list);
	}
	return [...map.entries()]
		.sort((a, b) => b[0] - a[0])
		.map(([year, months]) => ({ year, months: months.sort((a, b) => b.month - a.month) }));
});

// Look up month label for display/SEO. Always returns a string so the i18n
// translator receives a concrete value (never undefined).
const monthLabel = computed(() => {
	if (!month.value) return "";
	return new Date(Date.UTC(2000, month.value - 1, 1)).toLocaleString(
		locale.value === "zh" ? "zh-CN" : "en-US",
		{ month: "long" },
	);
});

useSeo(() => ({
	title: hasPeriod.value
		? t("archive.monthTitle", { year: year.value ?? "", month: monthLabel.value })
		: t("archive.title"),
	description: hasPeriod.value
		? t("archive.monthDesc", { year: year.value ?? "", month: monthLabel.value })
		: t("archive.desc"),
	path: "/archive",
}));
</script>

<template>
  <div class="max-w-5xl mx-auto">
    <!-- Loading state -->
    <div v-if="pending" class="space-y-4">
      <div class="bg-gray-100 animate-pulse h-8 rounded-lg mb-4 w-1/3" />
      <div class="space-y-2">
        <div v-for="i in 6" :key="i" class="bg-gray-100 animate-pulse h-4 rounded w-2/3" />
      </div>
    </div>

    <!-- Archive index view (no year/month selected) -->
    <div v-else-if="!hasPeriod" class="space-y-8">
      <div>
        <h1
          class="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent mb-2"
        >
          {{ t('archive.title') }}
        </h1>
        <p class="text-gray-500 dark:text-gray-400">
          {{ t('archive.desc') }}
        </p>
      </div>

      <div
        v-if="years.length"
        class="space-y-6"
      >
        <section
          v-for="y in years"
          :key="y.year"
        >
          <h2 class="text-xl font-bold text-gray-800 dark:text-gray-100 mb-3">
            {{ y.year }}
          </h2>
          <div class="flex flex-wrap gap-3">
            <NuxtLink
              v-for="m in y.months"
              :key="m.month"
              :to="{ query: { year: String(m.year), month: String(m.month) } }"
              class="px-4 py-2 bg-gradient-to-r from-purple-500 to-indigo-500 text-white rounded-xl text-sm font-medium hover:from-purple-600 hover:to-indigo-600 transition-all shadow-md hover:shadow-lg"
            >
              {{
                new Date(Date.UTC(m.year, m.month - 1, 1)).toLocaleString(
                  locale === "zh" ? "zh-CN" : "en-US",
                  { month: "long" },
                )
              }}
              <span class="opacity-80 text-xs">({{ m.count }})</span>
            </NuxtLink>
          </div>
        </section>
      </div>

      <div
        v-else
        class="text-center py-12 text-gray-500"
      >
        {{ t('archive.empty') }}
      </div>
    </div>

    <!-- Posts for a selected year/month -->
    <div v-else>
      <div class="mb-8">
        <NuxtLink
          to="/archive"
          class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-purple-600 transition-colors mb-4"
        >
          <Icon icon="lucide:arrow-left" class="w-4 h-4" />
          {{ t('archive.backToAll') }}
        </NuxtLink>
        <h1 class="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent">
          {{ t('archive.monthTitle', { year: year ?? '', month: monthLabel }) }}
        </h1>
        <p class="text-gray-500 dark:text-gray-400 mt-1">
          {{ t('archive.countLabel', { count: posts?.pagination?.total ?? 0 }) }}
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
              {{ new Date(post.created_at).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US") }}
            </span>
            <span>{{ t('archive.views', { count: post.views }) }}</span>
          </div>
        </div>

        <!-- Pagination -->
        <div
          v-if="posts && posts.pagination.total_pages > 1"
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
            @click="navigateTo({ query: { year: String(year), month: String(month), page: pg } })"
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
        {{ t('archive.postsEmpty') }}
      </div>
    </div>
  </div>
</template>
