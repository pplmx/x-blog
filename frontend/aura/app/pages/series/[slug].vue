<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useSeriesBySlug } from "~~/api/public/series";
import {
	followReaderSeries,
	getReaderSeriesFollows,
	setSeriesFollowNotify,
	unfollowReaderSeries,
} from "~~/api/reader/follows";
import type { SeriesProgress } from "~~/api/reader/history";
import { getReaderSeriesProgress } from "~~/api/reader/history";
import { parseApiDate } from "~~/composables/apiDate";
import { useSeo } from "~~/composables/useSeo";

const { t, locale } = useLang();
const route = useRoute();
// Reactive getter so useFetch refetches when the slug changes via SPA
// navigation between series (mirrors the posts/[slug] pattern, TASK-090).
const {
	data: series,
	pending,
	error,
	refresh: refreshSeries,
} = await useSeriesBySlug(() => route.params.slug as string);
function retryLoad() {
	void refreshSeries();
}

useSeo(() => ({
	title: series.value?.title ? `${series.value.title} — ${t("series.all")}` : t("series.all"),
	description: series.value?.description || t("series.allDesc"),
	path: `/series/${route.params.slug}`,
}));

// Series reading progress (DEC-122, TASK-173): a signed-in reader sees how far
// through the series they are (derived from their reading history) and can
// continue from the first unread episode. Guests see no progress.
const signedIn = computed(
	() =>
		typeof window !== "undefined" &&
		typeof localStorage?.getItem === "function" &&
		!!localStorage.getItem("reader_token"),
);
const progress = ref<SeriesProgress | null>(null);

onMounted(async () => {
	if (!signedIn.value || !series.value?.slug) return;
	void loadFollowState();
	void loadProgress();
});

const progressPercent = computed(() => {
	if (!progress.value || progress.value.total <= 0) return 0;
	return Math.round((progress.value.read_count / progress.value.total) * 100);
});

// Scoped RSS feed (DEC-130/TASK-177): subscribe to just this series.
const feedUrl = computed(() => (series.value?.slug ? `/rss/series/${series.value.slug}.xml` : ""));
useHead(() => ({
	link: feedUrl.value
		? [
				{
					rel: "alternate",
					type: "application/rss+xml",
					title: series.value?.title,
					href: feedUrl.value,
				},
			]
		: [],
}));

// Follow series for 'new part' push (DEC-132/TASK-178): shown to signed-in readers.
const followsSeries = ref(false);
const followNotify = ref(true);
const followBusy = ref(false);

async function loadFollowState() {
	if (!signedIn.value || !series.value?.id) return;
	try {
		// Imperative $fetch seam: the old useReaderSeriesFollows (useFetch query)
		// silently never sent its request from onMounted, so the follow state was
		// always reset to "not following" on every full load/reload (ISS-119,
		// TASK-220 — same class as the account/tag GETs, getReaderTagFollows).
		const res = await getReaderSeriesFollows();
		const item = res.items.find((f) => f.id === series.value?.id) ?? null;
		followsSeries.value = !!item;
		followNotify.value = item?.notify ?? true;
	} catch {
		followsSeries.value = false;
		followNotify.value = true;
	}
}

/** Load the reader's progress through this series ($fetch seam, TASK-220). */
async function loadProgress() {
	if (!signedIn.value || !series.value?.slug) return;
	try {
		progress.value = await getReaderSeriesProgress(series.value.slug);
	} catch {
		progress.value = null;
	}
}

async function toggleFollow() {
	if (followBusy.value || !series.value?.id) return;
	followBusy.value = true;
	try {
		if (followsSeries.value) {
			await unfollowReaderSeries(series.value.id);
			followsSeries.value = false;
		} else {
			const res = await followReaderSeries(series.value.id);
			followsSeries.value = true;
			followNotify.value = res?.notify ?? true;
		}
	} catch {
		// best-effort — keep current state on failure
	} finally {
		followBusy.value = false;
	}
}

/** Toggle new-part push on/off for a followed series (TASK-181). */
async function toggleNotify() {
	if (followBusy.value || !series.value?.id || !followsSeries.value) return;
	followBusy.value = true;
	const next = !followNotify.value;
	try {
		const res = await setSeriesFollowNotify(series.value.id, next);
		followNotify.value = res?.notify ?? next;
	} catch {
		// best-effort — keep current brightness on failure
	} finally {
		followBusy.value = false;
	}
}
</script>

<template>
  <div class="max-w-4xl mx-auto">
    <!-- Loading state -->
    <div v-if="pending" class="space-y-6 pt-8" role="status" aria-busy="true">
      <div class="bg-gray-100 dark:bg-gray-800 animate-pulse h-8 rounded-lg w-1/2" />
      <div class="bg-gray-100 dark:bg-gray-800 animate-pulse h-4 rounded w-1/3" />
      <div class="space-y-4">
        <div v-for="i in 4" :key="i" class="bg-gray-100 dark:bg-gray-800 animate-pulse h-24 rounded-2xl" />
      </div>
    </div>

    <div v-else-if="error" class="text-center py-20 text-gray-500" role="alert">
      <Icon icon="lucide:alert-circle" class="w-12 h-12 mx-auto mb-4 text-gray-300" />
      <p class="mb-4">{{ t('common.state.loadFailed') }}</p>
      <button
        type="button"
        class="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        @click="retryLoad"
      >
        {{ t('common.action.retry') }}
      </button>
    </div>

    <div v-else-if="!series" class="text-center py-20 text-gray-500">
      <Icon icon="lucide:layers" class="w-12 h-12 mx-auto mb-4 text-gray-300" />
      <p>{{ t('series.notFound') }}</p>
    </div>

    <div v-else class="space-y-8 pt-8">
      <div class="mb-8">
        <NuxtLink
          to="/series"
          class="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors mb-4"
        >
          <Icon icon="lucide:arrow-left" class="w-4 h-4" />
          {{ t('series.backToAll') }}
        </NuxtLink>
        <h1
          class="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent"
        >
          {{ series.title }}
        </h1>
        <div class="flex items-center gap-3 mt-3 text-sm text-gray-400">
          <span class="inline-flex items-center gap-1">
            <Icon icon="lucide:layers" class="w-4 h-4" />
            {{ t('series.countLabel', { count: series.post_count }) }}
          </span>
          <a
            v-if="feedUrl"
            :href="feedUrl"
            target="_blank"
            rel="noopener"
            :title="t('series.subscribeFeed')"
            class="inline-flex items-center gap-1 text-indigo-500 hover:text-indigo-700 transition-colors"
          >
            <Icon icon="lucide:rss" class="w-4 h-4" />
            {{ t('series.subscribeFeed') }}
          </a>
          <button
            v-if="signedIn"
            type="button"
            :disabled="followBusy"
            :title="t(followsSeries ? 'series.followingNewPartsTitle' : 'series.followNewPartsTitle')"
            class="inline-flex items-center gap-1 text-fuchsia-500 hover:text-fuchsia-700 transition-colors disabled:opacity-60"
            @click="toggleFollow"
          >
            <Icon :icon="followsSeries ? 'lucide:bell-ring' : 'lucide:bell'" class="w-4 h-4" />
            {{ followsSeries ? t('series.followingNewParts') : t('series.followNewParts') }}
          </button>
          <button
            v-if="followsSeries"
            type="button"
            :disabled="followBusy"
            :title="t('series.notifyTitle')"
            class="inline-flex items-center gap-1 text-indigo-500 hover:text-indigo-700 transition-colors disabled:opacity-60"
            @click="toggleNotify"
          >
            <Icon :icon="followNotify ? 'lucide:bell' : 'lucide:bell-off'" class="w-4 h-4" />
            {{ t(followNotify ? 'series.notifyOn' : 'series.notifyOff') }}
          </button>
        </div>
        <p v-if="series.description" class="mt-4 text-lg text-gray-600 dark:text-gray-400 leading-relaxed">
          {{ series.description }}
        </p>

        <!-- Reader series progress (signed-in) -->
        <div
          v-if="signedIn && progress"
          class="mt-6 p-4 rounded-2xl border border-indigo-100 dark:border-indigo-900/40 bg-indigo-50/50 dark:bg-indigo-900/10"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <Icon icon="lucide:list-checks" class="w-4 h-4 text-indigo-500" />
              <span class="text-sm font-medium text-gray-700 dark:text-gray-200">
                {{ t('series.progressTitle') }}
              </span>
              <span class="text-sm text-gray-500 dark:text-gray-400">
                {{ t('series.readCountLabel', { read: progress.read_count, total: progress.total }) }}
              </span>
              <span
                v-if="progress.completed"
                class="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400"
              >
                <Icon icon="lucide:check-circle-2" class="w-3.5 h-3.5" />
                {{ t('series.completed') }}
              </span>
            </div>
            <NuxtLink
              v-if="progress.next_slug"
              :to="`/posts/${progress.next_slug}`"
              class="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
            >
              {{ t('series.continueReading') }}
              <Icon icon="lucide:arrow-right" class="w-4 h-4" />
            </NuxtLink>
          </div>
          <div class="mt-3 h-2 rounded-full bg-indigo-100 dark:bg-indigo-900/30 overflow-hidden">
            <div
              class="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-500"
              :style="{ width: progressPercent + '%' }"
            />
          </div>
        </div>
      </div>

      <!-- Ordered series posts -->
      <div
        v-if="series.posts?.length"
        class="space-y-4"
      >
        <div
          v-for="(post, idx) in series.posts"
          :key="post.id"
          class="border border-gray-100 dark:border-gray-800 rounded-2xl p-5 hover:shadow-lg hover:border-blue-200 dark:hover:border-blue-800 transition-all duration-200"
        >
          <NuxtLink :to="`/posts/${post.slug}`" class="block group">
            <div class="flex items-center gap-3">
              <span class="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 text-white text-sm font-semibold">
                {{ idx + 1 }}
              </span>
              <h2 class="text-lg font-bold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-2">
                {{ post.title }}
              </h2>
            </div>
            <div v-if="post.excerpt" class="mt-2 ml-11 text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
              {{ post.excerpt }}
            </div>
            <div class="mt-2 ml-11 flex items-center gap-4 text-xs text-gray-400">
              <span class="flex items-center gap-1">
                <Icon icon="lucide:calendar" class="w-3.5 h-3.5" />
                {{ parseApiDate(post.created_at)?.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US") ?? "" }}
              </span>
              <span class="flex items-center gap-1">
                <Icon icon="lucide:eye" class="w-3.5 h-3.5" />
                {{ t('series.views', { count: post.views || 0 }) }}
              </span>
            </div>
          </NuxtLink>
        </div>
      </div>

      <div
        v-else
        class="text-center py-12 text-gray-500"
      >
        {{ t('series.postsEmpty') }}
      </div>
    </div>
  </div>
</template>
