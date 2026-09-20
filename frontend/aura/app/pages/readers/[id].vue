<script setup lang="ts">
/**
 * Public reader profile page (DEC-294, TASK-376; liked-posts tab round 360).
 *
 * A commenter's verified display name links here: display name, join date, and
 * the approved comments they've left on publicly-visible posts, paginated. A
 * reader who opted in (public_likes, /account) gets a second "Liked posts" tab
 * (DEC-393) — the first reader-to-reader taste-discovery surface — fed by the
 * public GET /api/readers/{id}/likes and browseable by anyone, no sign-in.
 * Public — no auth gate (unlike the account settings at /account). A 404
 * (unknown/deleted reader) renders a "reader not found" state instead of an
 * empty profile (a profile is only reachable from a comment that carried its
 * id, so a miss is a broken link, not a legitimately empty page).
 */
import { computed, ref, watch } from "vue";
import type { PaginationInfo, PostList, PostListResponse } from "~~/api/contracts/shared";
import {
	getReaderProfile,
	getReaderPublicBookmarks,
	getReaderPublicLikes,
} from "~~/api/public/readers";
// biome-ignore lint/correctness/noUnusedImports: used from the template — biome cannot resolve Vue script-setup template bindings (vue-tsc verifies).
import { parseApiDate } from "~~/composables/apiDate";
import { scrollToPageTop } from "~~/composables/scrollToTop";
import { paginationPages } from "~~/composables/usePagination";
import { useSeo } from "~~/composables/useSeo";

const { t, locale } = useLang();
const route = useRoute();
const readerId = computed(() => Number(route.params.id));

useSeo(() => ({
	title: t("readerProfile.seoTitle"),
	description: t("readerProfile.seoDesc"),
	path: `/readers/${readerId.value}`,
	locale: locale.value,
}));

// TASK-478/ISS-554: clamp an invalid ?page= (non-numeric, zero, negative) to
// page 1 at the computed — the profile fetch must never carry NaN/0
// (guaranteed 422), and the out-of-range clamp watcher below short-circuits
// NaN/<2, so without this an invalid deep link would brick the profile with a
// dead Retry. Same pattern as follows.vue/liked.vue.
const page = computed(() => {
	const raw = route.query.page ? Number.parseInt(String(route.query.page), 10) : 1;
	return Number.isNaN(raw) || raw < 1 ? 1 : raw;
});

// Active tab; "likes"/"saved" only render for readers who opted in
// (public_likes / public_bookmarks) — otherwise the URL's ?view=likes or
// ?view=saved silently falls back to the comments tab.
type ProfileView = "comments" | "likes" | "saved";
const view = computed<ProfileView>(() => {
	if (route.query.view === "likes" && data.value?.profile.public_likes) return "likes";
	if (route.query.view === "saved" && data.value?.profile.public_bookmarks) return "saved";
	return "comments";
});

const loading = ref(true);
const loadFailed = ref(false);
const notFound = ref(false);
const data = ref<Awaited<ReturnType<typeof getReaderProfile>> | null>(null);

// Liked-posts tab state (round 360): the public likes list is fetched only
// when the tab is active, so a profile that never opted in makes no request.
const likedLoading = ref(false);
const likedFailed = ref(false);
const likedPosts = ref<PostList[]>([]);
const likedPagination = ref<PaginationInfo | null>(null);

async function loadLikes() {
	if (!data.value?.profile.public_likes) return;
	likedLoading.value = true;
	likedFailed.value = false;
	try {
		const res: PostListResponse | null = await getReaderPublicLikes(readerId.value, page.value, 20);
		likedPosts.value = res?.items ?? [];
		likedPagination.value = res?.pagination ?? null;
	} catch (cause) {
		// The tab only renders when the profile said public_likes, so a 404 is
		// a lost race (reader just opted out) rather than a "couldn't load".
		const status = (cause as { response?: { status?: number } } | undefined)?.response?.status;
		if (status !== 404) likedFailed.value = true;
		likedPosts.value = [];
		likedPagination.value = null;
	} finally {
		likedLoading.value = false;
	}
}

// Saved-posts tab state (round 363, DEC-399): same lazy pattern as likes —
// the curated bookmark list is fetched only when the tab is active.
const savedLoading = ref(false);
const savedFailed = ref(false);
const savedPosts = ref<PostList[]>([]);
const savedPagination = ref<PaginationInfo | null>(null);

async function loadSaved() {
	if (!data.value?.profile.public_bookmarks) return;
	savedLoading.value = true;
	savedFailed.value = false;
	try {
		const res: PostListResponse | null = await getReaderPublicBookmarks(
			readerId.value,
			page.value,
			20,
		);
		savedPosts.value = res?.items ?? [];
		savedPagination.value = res?.pagination ?? null;
	} catch (cause) {
		// 404 = lost race (reader just opted out), not a load failure.
		const status = (cause as { response?: { status?: number } } | undefined)?.response?.status;
		if (status !== 404) savedFailed.value = true;
		savedPosts.value = [];
		savedPagination.value = null;
	} finally {
		savedLoading.value = false;
	}
}

async function load() {
	loading.value = true;
	loadFailed.value = false;
	notFound.value = false;
	// A non-numeric id (e.g. /readers/abc) is a broken link, not a server
	// problem — rendering "not found" beats showing a retry for a 422 from
	// `Path(ge=1)`.
	if (Number.isNaN(readerId.value)) {
		notFound.value = true;
		loading.value = false;
		return;
	}
	try {
		const res = await getReaderProfile(readerId.value, page.value);
		data.value = res;
		// Refresh the active discovery tab when it is active (its paging rides
		// the same ?page= parameter the comments tab pages).
		if (view.value === "likes") await loadLikes();
		if (view.value === "saved") await loadSaved();
	} catch (cause) {
		// 404 from the API → the reader doesn't exist (or never had a public
		// identity); render the not-found state, not a "couldn't load" retry.
		const status = (cause as { response?: { status?: number } } | undefined)?.response?.status;
		if (status === 404) {
			notFound.value = true;
		} else {
			loadFailed.value = true;
		}
	} finally {
		loading.value = false;
	}
}

watch([readerId, page, () => route.query.view], () => {
	void load();
});

// Page-clamp: an out-of-range deep link (e.g. ?page=99) has an empty page but
// real total_pages — send the reader back to the last real page (home/search/
// archive pattern, deep-dive finding ISS-308).
const activePagination = computed(() =>
	view.value === "likes"
		? likedPagination.value
		: view.value === "saved"
			? savedPagination.value
			: data.value?.pagination,
);
watch(activePagination, (p) => {
	const requested = page.value;
	if (!p || Number.isNaN(requested) || requested < 2) return;
	const last = p.total_pages ?? 1;
	// Keep the active tab in the URL while clamping; an empty profile
	// (total_pages 0) drops the page param entirely (ISS-308 pattern).
	if (requested > last) {
		const query: Record<string, string> = {};
		if (last >= 1) query.page = String(last);
		if (view.value === "likes") query.view = "likes";
		if (view.value === "saved") query.view = "saved";
		void navigateTo({ query }, { replace: true });
	}
});

/** Switch tabs through the URL so the tab AND the page stay deep-linkable
 *  (a shared ?view=likes / ?view=saved link lands straight on that tab). */
function setView(next: ProfileView) {
	void navigateTo({
		query: {
			view: next === "likes" ? "likes" : next === "saved" ? "saved" : undefined,
			page: undefined,
		},
	});
	scrollToPageTop();
}

function goToPage(pg: number | string) {
	void navigateTo({
		query: {
			page: pg === 1 ? undefined : String(pg),
			view: view.value === "likes" ? "likes" : view.value === "saved" ? "saved" : undefined,
		},
	});
	scrollToPageTop();
}

function retry() {
	void load();
}

await load();

const paginationTokens = computed(() =>
	paginationPages(activePagination.value?.total_pages ?? 0, page.value),
);

// Screen-reader page announcement (round 398, same pattern as home): pagination
// swaps the active tab's list in place, which is invisible to assistive tech —
// announce the landed page when it changes.
const pageAnnouncement = computed(() =>
	t("common.state.pageAnnounce", { page: activePagination.value?.page ?? page.value }),
);
</script>

<template>
	<div class="max-w-4xl mx-auto px-4 py-8 sm:py-12">
		<!-- Loading -->
		<div v-if="loading" class="space-y-4" role="status" aria-busy="true">
			<div class="bg-gray-100 dark:bg-gray-800 animate-pulse h-20 rounded-2xl w-2/3" />
			<div v-for="i in 3" :key="i" class="bg-gray-100 dark:bg-gray-800 animate-pulse h-16 rounded-xl" />
		</div>

		<!-- Not found -->
		<div v-else-if="notFound" class="text-center py-16">
			<Icon icon="lucide:user-x" class="w-12 h-12 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
			<h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
				{{ t("readerProfile.notFoundTitle") }}
			</h1>
			<p class="text-gray-500">{{ t("readerProfile.notFoundDesc") }}</p>
			<NuxtLink
				to="/"
				class="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
			>
				<Icon icon="lucide:arrow-left" class="w-4 h-4" />
				{{ t("common.action.backHome") }}
			</NuxtLink>
		</div>

		<!-- Load failure -->
		<div v-else-if="loadFailed" class="text-center py-16">
			<p class="text-gray-500" role="alert">{{ t("readerProfile.loadFailed") }}</p>
			<button
				type="button"
				class="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
				@click="retry"
			>
				<Icon icon="lucide:refresh-cw" class="w-4 h-4" />
				{{ t("common.action.retry") }}
			</button>
		</div>

		<template v-else-if="data">
			<!-- Profile header -->
			<div class="flex items-center gap-4 mb-6 rounded-2xl border border-gray-100 dark:border-gray-800 p-6">
				<!-- Avatar (DEC-299/TASK-378): the reader's uploaded picture when
					 set, else the initial-letter placeholder (text-only identity). -->
				<img
					v-if="data.profile.avatar_url"
					:src="data.profile.avatar_url"
					:alt="data.profile.display_name || 'avatar'"
					class="shrink-0 w-16 h-16 rounded-full object-cover border border-gray-100 dark:border-gray-800"
				/>
				<div
					v-else
					class="shrink-0 flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-2xl font-bold"
				>
					{{ (data.profile.display_name || "R").charAt(0).toUpperCase() }}
				</div>
				<div>
					<h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
						{{ data.profile.display_name || t("readerProfile.anonymousName") }}
						<span
							class="inline-flex items-center gap-0.5 text-[11px] text-blue-600 dark:text-blue-400"
							:title="t('components.commentList.verifiedReader')"
						>
							<Icon icon="lucide:badge-check" class="w-3.5 h-3.5" />
						</span>
					</h1>
					<p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
						{{ t("readerProfile.joined", { date: parseApiDate(data.profile.created_at)?.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US") ?? "" }) }}
					</p>
					<!-- Reader-written "about me" (round 352): plain text under the
						 name when the reader wrote one. -->
					<p
						v-if="data.profile.bio"
						class="mt-3 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 leading-relaxed"
					>
						{{ data.profile.bio }}
					</p>
				</div>
				<!-- Reader-to-reader follow (round 365, DEC-403): the follower
					 count is public; a signed-in reader who isn't viewing their own
					 profile gets a Follow/Following toggle that subscribes them to
					 this commenter's approved-comment fan-out. -->
				<ReaderFollowButton
					class="ml-auto shrink-0"
					:reader-id="data.profile.id"
					:initial-following="data.profile.is_following"
					:initial-follower-count="data.profile.follower_count"
				/>
				<!-- Reader block (round 379, DEC-425): the harassment-control
					 cousin — a signed-in reader can block this reader so their
					 mentions / replies / thread-comments / follow-activity stop
					 landing. One-way and invisible; the follower count and follow
					 button stay untouched. -->
				<div class="shrink-0">
					<ReaderBlockButton
						:reader-id="data.profile.id"
						:initial-blocked="data.profile.is_blocked"
					/>
				</div>
			</div>

			<!-- Tabs: comments always; "Liked posts" only when the reader opted in
				 (round 360, DEC-393). The opt-in flag on the profile drives this —
				 no Likes tab at all for readers who chose to keep their likes
				 private (a tablist of one is still a valid tablist). -->
			<div
				class="mb-6 flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-900 rounded-xl w-fit"
				role="tablist"
			>
				<button
					type="button"
					:aria-pressed="view === 'comments'"
					role="tab"
					:aria-selected="view === 'comments'"
					class="py-2 px-4 text-sm font-medium rounded-lg transition-colors"
					:class="view === 'comments'
						? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
						: 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'"
					@click="view !== 'comments' && setView('comments')"
				>
					<Icon icon="lucide:message-square" class="w-4 h-4 inline-block mr-1" />
					{{ t("readerProfile.commentsTitle") }}
				</button>
				<button
					v-if="data.profile.public_likes"
					type="button"
					:aria-pressed="view === 'likes'"
					role="tab"
					:aria-selected="view === 'likes'"
					class="py-2 px-4 text-sm font-medium rounded-lg transition-colors"
					:class="view === 'likes'
						? 'bg-white dark:bg-gray-700 text-pink-600 dark:text-pink-400 shadow-sm'
						: 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'"
					@click="view !== 'likes' && setView('likes')"
				>
					<Icon icon="lucide:heart" class="w-4 h-4 inline-block mr-1" />
					{{ t("readerProfile.likesTab") }}
				</button>
				<button
					v-if="data.profile.public_bookmarks"
					type="button"
					:aria-pressed="view === 'saved'"
					role="tab"
					:aria-selected="view === 'saved'"
					class="py-2 px-4 text-sm font-medium rounded-lg transition-colors"
					:class="view === 'saved'
						? 'bg-white dark:bg-gray-700 text-fuchsia-600 dark:text-fuchsia-400 shadow-sm'
						: 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'"
					@click="view !== 'saved' && setView('saved')"
				>
					<Icon icon="lucide:bookmark" class="w-4 h-4 inline-block mr-1" />
					{{ t("readerProfile.savedTab") }}
				</button>
			</div>

			<!-- Screen-reader page announcement (round 398, same pattern as
			     home): any tab's pagination swaps its list in place. -->
			<span role="status" aria-live="polite" class="sr-only">{{ pageAnnouncement }}</span>

			<!-- Comments tab -->
			<template v-if="view === 'comments'">
				<h2 class="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
					{{ t("readerProfile.commentsTitle") }}
					<span v-if="data.pagination" class="text-sm font-normal text-gray-400">
						{{ t("readerProfile.countLabel", { count: data.pagination.total }) }}
					</span>
				</h2>

				<div v-if="data.items.length" class="space-y-3">
					<article
						v-for="comment in data.items"
						:key="comment.id"
						class="border border-gray-100 dark:border-gray-800 rounded-xl p-4"
					>
						<div class="flex items-center gap-2 text-xs text-gray-400 mb-2">
							<NuxtLink
								v-if="comment.post"
								:to="`/posts/${comment.post.slug}#comment-${comment.id}`"
								class="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
							>
								<Icon icon="lucide:file-text" class="w-3.5 h-3.5" />
								{{ comment.post.title }}
							</NuxtLink>
							<span>{{ parseApiDate(comment.created_at)?.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US") ?? "" }}</span>
						</div>
						<!-- Plain-text (escaped) rendering, deliberately NOT the markdown
							 pipeline the post page uses: this is a compact comment-history
							 view, and text interpolation keeps user content escaped (no
							 v-html) — the post page remains the rich-text surface for a
							 given comment. -->
						<div class="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">
							{{ comment.content }}
						</div>
					</article>
				</div>

				<div v-else class="text-center py-12 text-gray-500">
					{{ t("readerProfile.empty") }}
				</div>
			</template>

			<!-- Liked-posts tab (round 360, DEC-393) -->
			<template v-else-if="view === 'likes'">
				<div v-if="likedLoading" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					<div v-for="i in 3" :key="i" class="h-24 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
				</div>

				<p
					v-else-if="likedFailed"
					class="text-center py-12 text-gray-500"
					role="alert"
				>
					{{ t("readerProfile.likesLoadFailed") }}
				</p>

				<template v-else>
					<p v-if="likedPagination" class="text-sm text-gray-400 mb-4">
						{{ t("readerProfile.likesCountLabel", { count: likedPagination.total }) }}
					</p>

					<div v-if="likedPosts.length" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						<NuxtLink
							v-for="post in likedPosts"
							:key="post.id"
							:to="`/posts/${post.slug}`"
							class="group p-4 rounded-xl border border-gray-100 dark:border-gray-800 hover:border-pink-200 dark:hover:border-pink-800 hover:shadow-md transition-all duration-200"
						>
							<h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 group-hover:text-pink-600 dark:group-hover:text-pink-400 transition-colors line-clamp-2">
								{{ post.title }}
							</h3>
							<div class="mt-2 flex items-center gap-2 text-xs text-gray-400">
								<span v-if="post.category" class="inline-flex items-center gap-1">
									<Icon icon="lucide:folder" class="w-3 h-3" />
									{{ post.category.name }}
								</span>
								<span>{{ post.likes }} {{ t("readerProfile.likesCountWord") }}</span>
							</div>
						</NuxtLink>
					</div>

					<div v-else class="text-center py-12 text-gray-500">
						{{ t("readerProfile.likesEmpty") }}
					</div>
				</template>
			</template>

			<!-- Saved-posts tab (round 363, DEC-399) -->
			<template v-else>
				<div v-if="savedLoading" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					<div v-for="i in 3" :key="i" class="h-24 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
				</div>

				<p
					v-else-if="savedFailed"
					class="text-center py-12 text-gray-500"
					role="alert"
				>
					{{ t("readerProfile.savedLoadFailed") }}
				</p>

				<template v-else>
					<p v-if="savedPagination" class="text-sm text-gray-400 mb-4">
						{{ t("readerProfile.savedCountLabel", { count: savedPagination.total }) }}
					</p>

					<div v-if="savedPosts.length" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						<NuxtLink
							v-for="post in savedPosts"
							:key="post.id"
							:to="`/posts/${post.slug}`"
							class="group p-4 rounded-xl border border-gray-100 dark:border-gray-800 hover:border-fuchsia-200 dark:hover:border-fuchsia-800 hover:shadow-md transition-all duration-200"
						>
							<h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 group-hover:text-fuchsia-600 dark:group-hover:text-fuchsia-400 transition-colors line-clamp-2">
								{{ post.title }}
							</h3>
							<div class="mt-2 flex items-center gap-2 text-xs text-gray-400">
								<span v-if="post.category" class="inline-flex items-center gap-1">
									<Icon icon="lucide:folder" class="w-3 h-3" />
									{{ post.category.name }}
								</span>
								<span>{{ post.views }} {{ t("readerProfile.savedViewsWord") }}</span>
							</div>
						</NuxtLink>
					</div>

					<div v-else class="text-center py-12 text-gray-500">
						{{ t("readerProfile.savedEmpty") }}
					</div>
				</template>
			</template>

			<!-- Pagination (windowed with ellipsis, matching home/search/archive) -->
			<div
				v-if="activePagination?.total_pages && activePagination.total_pages > 1"
				class="flex items-center justify-center gap-2 mt-8"
				role="navigation"
				:aria-label="view === 'likes' ? t('readerProfile.likesTab') : view === 'saved' ? t('readerProfile.savedTab') : t('readerProfile.commentsTitle')"
			>
				<button
					v-for="(pg, i) in paginationTokens"
					:key="pg === '…' ? `ellipsis-${i}` : pg"
					type="button"
					:disabled="pg === '…' || pg === page"
					:aria-current="pg !== '…' && pg === page ? 'page' : undefined"
					:class="[
						'px-3 py-1 rounded transition-colors',
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
		</template>
	</div>
</template>
