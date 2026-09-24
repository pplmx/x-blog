<script setup lang="ts">
/**
 * Reader liked-posts page (round 359, DEC-391/TASK-421).
 *
 * The "posts I appreciated" surface that joins bookmarks (saved to read) and
 * history (read): every post the signed-in reader liked, newest-like-first,
 * paginated. Likes are durable cloud rows, so a like made on one device shows
 * here on the next — and unlike here removes it (decrementing the count).
 * Auth-scoped like the follows feed: guests are redirected to /login, and a
 * stale session drops back to the same sign-in route.
 */
import { computed, onMounted, onUnmounted, watch } from "vue";
import type { PaginationInfo, PostList } from "~~/api/contracts/shared";
import { getReaderLikes } from "~~/api/reader/likes";
import { scrollToPageTop } from "~~/composables/scrollToTop";
import { useLikeSync } from "~~/composables/useLikeSync";
import { paginationPages } from "~~/composables/usePagination";
import { useReaderAuth } from "~~/composables/useReaderAuth";
import { useSeo } from "~~/composables/useSeo";

const { t } = useLang();
const route = useRoute();
const router = useRouter();
const { isAuthenticated, logout, isStaleSession } = useReaderAuth();
const { likeSyncIssue, clearLikeSyncIssue, mergeLocalToCloud, unlike } = useLikeSync();

// Guests and stale sessions land on /login with the return path back to this
// page (ISS-563): sign in once and come straight back to the likes instead of
// dumping onto the default /bookmarks landing (comments/account parity — the
// login page only honors same-origin relative redirect values).
const loginTarget = { path: "/login", query: { redirect: "/liked" } } as const;

useSeo(() => ({
	title: t("liked.seoTitle"),
	description: t("liked.seoDesc"),
	path: "/liked",
}));

// Page comes from the query string so pagination is deep-linkable; a malformed
// `?page=abc` parses to NaN, and a `?page=0`/negative value is below the lowest
// valid page — both resolve to page 1 (the backend rejects PageInt < 1 with 422,
// and without this a bad deep link would loop on load-failure + retry; deep-dive
// finding).
const page = computed(() => {
	const raw = route.query.page ? Number.parseInt(String(route.query.page), 10) : 1;
	return Number.isNaN(raw) || raw < 1 ? 1 : raw;
});

const items = ref<PostList[]>([]);
const pending = ref(true);
const loadFailed = ref(false);
const pagination = ref<PaginationInfo | null>(null);
// Monotonic request sequence (see load() — the stale-response guard).
let loadSeq = 0;

// Recall search over the reader's liked posts (DEC-413, TASK-432): the last
// reader-owned surface without keyword search — bookmarks (DEC-124), history
// (DEC-148) and my-comments (round 369) all let a reader find a specific item.
// Server-side `q` (title/excerpt) is debounced like history's recall-search so
// fast typing doesn't fire a request per keystroke.
const searchQuery = ref("");
const searching = computed(() => searchQuery.value.trim() !== "");
let searchTimer: ReturnType<typeof setTimeout> | null = null;
async function applySearch() {
	// A new term restarts from page 1 — a search from a deep page would
	// overshoot the (smaller) filtered total. The page lives in the URL, so a
	// term change drops back there and the watch([page]) picks up the reload.
	if (page.value !== 1) {
		void navigateTo({ query: { page: undefined } }, { replace: true });
		return;
	}
	void load();
}
function onSearch() {
	if (searchTimer) clearTimeout(searchTimer);
	searchTimer = setTimeout(() => void applySearch(), 300);
}
function clearSearch() {
	searchQuery.value = "";
	if (searchTimer) clearTimeout(searchTimer);
	void applySearch();
}
// Clear the pending debounce on unmount so a delayed search can't fire against
// an unmounted component after the reader left (wasted server call).
onUnmounted(() => {
	if (searchTimer) {
		clearTimeout(searchTimer);
		searchTimer = null;
	}
});

const paginationTokens = computed(() =>
	paginationPages(pagination.value?.total_pages ?? 0, page.value),
);

// Screen-reader page announcement (round 398, same pattern as home): pagination
// swaps the grid in place, which is invisible to assistive tech — announce the
// landed page when it changes.
const pageAnnouncement = computed(() => t("common.state.pageAnnounce", { page: page.value }));

// Stale deep-link clamp (home/search/archive pattern, ISS-308).
watch(
	() => pagination.value,
	(p) => {
		const requested = page.value;
		if (!p || Number.isNaN(requested) || requested < 2) return;
		const last = p.total_pages ?? 1;
		if (requested > last && last >= 1) {
			void navigateTo({ query: { page: String(last) } }, { replace: true });
		}
	},
);

async function load() {
	if (!isAuthenticated.value) return;
	// Monotonic request sequence so a slow earlier response (page / search) can
	// never overwrite a newer one — the same race every sibling filter/search
	// page already guards (liked.vue/follows.vue were the holdouts). Without it,
	// two quick search edits could land out of order and show stale results
	// under the newer term (deep-dive finding).
	const seq = ++loadSeq;
	pending.value = true;
	loadFailed.value = false;
	try {
		const res = await getReaderLikes(page.value, 12, searchQuery.value);
		if (seq !== loadSeq) return; // a newer request wins
		items.value = res?.items ?? [];
		pagination.value = res?.pagination ?? null;
		const p = res?.pagination;
		const requested = page.value;
		if (!p || Number.isNaN(requested) || requested < 2) {
			pending.value = false;
		} else {
			const last = p.total_pages ?? 1;
			pending.value = requested > last && last >= 1;
		}
	} catch (cause) {
		if (isStaleSession(cause)) {
			logout();
			void router.replace(loginTarget);
			return;
		}
		if (seq !== loadSeq) return;
		items.value = [];
		pagination.value = null;
		loadFailed.value = true;
		pending.value = false;
	}
}

watch([page], () => {
	if (isAuthenticated.value) void load();
});

onMounted(async () => {
	if (!isAuthenticated.value) {
		void router.replace(loginTarget);
		return;
	}
	// Reconcile device-local likes up ONCE (a reader who liked while offline or
	// pre-cloud sees them here) and adopt the merged server set. Deliberately
	// NOT inside load(): pagination turns re-fetch a page of the server list,
	// and a push-all/pull-all merge on every turn would hammer the write budget
	// and stall paging on large liked sets (bookmarks merges once on mount).
	await mergeLocalToCloud();
	void load();
});

watch(isAuthenticated, (authed) => {
	if (authed) return;
	items.value = [];
	pagination.value = null;
	pending.value = false;
	loadFailed.value = false;
	void router.replace(loginTarget);
});

function goToPage(pg: number | string) {
	void navigateTo({ query: { page: pg === 1 ? undefined : String(pg) } });
	scrollToPageTop();
}

function retry() {
	void load();
}

// Per-card unlike (DEC-415, TASK-433): the page is the "posts I appreciated"
// list, so taking a like back should happen in place, not by visiting the post.
// useLikeSync.unlike() clears the local marker + persists + mirrors the DELETE
// (idempotent 204, decrements the public counter); offline-safe (the next
// merge re-conciliates). Single-flight per post like bookmarks' remove.
const unlikingIds = ref<Set<number>>(new Set());
const unlikeFailed = ref(false);

async function handleUnlike(post: PostList) {
	if (unlikingIds.value.has(post.id)) return; // single-flight per row
	unlikingIds.value.add(post.id);
	unlikeFailed.value = false;
	const prev = pagination.value;
	let persisted: boolean;
	try {
		persisted = await unlike(post.id);
	} catch (cause) {
		if (isStaleSession(cause)) {
			logout();
			void router.replace(loginTarget);
			return;
		}
		unlikeFailed.value = true;
		unlikingIds.value.delete(post.id);
		return;
	}
	// unlike() rolls the local marker back when the cloud DELETE didn't land
	// (offline / 5xx), so an unpersisted removal must NOT drop the card from
	// this server-truth page — it would reappear on the next visit (usability
	// deep-dive). Keep the card, surface a retry notice, and let the next merge
	// re-conciliate.
	if (!persisted) {
		unlikeFailed.value = true;
		unlikingIds.value.delete(post.id);
		return;
	}
	// The like is gone (locally + mirrored) — drop the card and its count.
	items.value = items.value.filter((p) => p.id !== post.id);
	if (pagination.value) {
		pagination.value = { ...pagination.value, total: Math.max(0, (prev?.total ?? 0) - 1) };
	}
	unlikingIds.value.delete(post.id);
	// Drain-clamp (comments-page pattern): unliking the only item on the last
	// page empties it under a non-zero total — reload so the stale-page clamp
	// sends the reader back onto the last populated page.
	if (items.value.length === 0 && (pagination.value?.total ?? 0) > 0) {
		void load();
	}
}
</script>

<template>
	<div class="max-w-4xl mx-auto px-4 py-8 sm:py-12">
		<div class="flex items-center gap-3 mb-6">
			<span class="text-pink-600 dark:text-pink-400">
				<Icon icon="lucide:heart" class="w-7 h-7" />
			</span>
			<div>
				<h1 class="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
					{{ t("liked.title") }}
				</h1>
				<p class="text-gray-500 dark:text-gray-400 mt-1 text-sm">
					{{ t("liked.subtitle") }}
				</p>
			</div>
			<!-- Dead-session warning (bookmarks-parity, ISS-222): the likes mirror
			     surfaced a stored token the backend no longer accepts, so likes are
			     kept locally but silently dropped by the cloud until sign-in again. -->
			<div
				v-if="likeSyncIssue === 'auth'"
				class="mb-2 flex items-center justify-between gap-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-800 dark:text-amber-200"
				role="alert"
			>
				<span class="min-w-0">
					{{ t("liked.authWarning") }}
					<NuxtLink
						:to="loginTarget"
						class="shrink-0 font-medium text-amber-800 dark:text-amber-200 underline underline-offset-2 hover:opacity-80"
					>
						{{ t("liked.login") }}
					</NuxtLink>
				</span>
				<button
					type="button"
					:aria-label="t('liked.dismiss')"
					class="shrink-0 p-1 rounded-lg text-amber-600 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
					@click="clearLikeSyncIssue"
				>
					<Icon icon="lucide:x" class="w-4 h-4" />
				</button>
			</div>
		</div>

		<div v-if="loadFailed" class="text-center py-12">
			<p class="text-gray-500" role="alert">{{ t("liked.loadFailed") }}</p>
			<button
				type="button"
				class="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
				@click="retry"
			>
				<Icon icon="lucide:refresh-cw" class="w-4 h-4" />
				{{ t("liked.retry") }}
			</button>
		</div>

		<div v-else-if="pending" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			<div
				v-for="i in 6"
				:key="i"
				class="h-24 rounded-xl border border-gray-100 dark:border-gray-800 animate-pulse"
			/>
		</div>

		<template v-else>
			<span role="status" aria-live="polite" class="sr-only">{{ pageAnnouncement }}</span>
			<!-- Recall search over the liked posts (DEC-413, TASK-432): debounced,
			     server-side, matches title/excerpt. -->
			<div class="relative mb-4 max-w-sm">
				<Icon
					icon="lucide:search"
					class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
				/>
				<input
					v-model="searchQuery"
					type="search"
					:placeholder="t('liked.searchPlaceholder')"
					:aria-label="t('liked.searchAria')"
					class="w-full pl-9 pr-9 py-2 rounded-xl text-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-pink-500"
					@input="onSearch"
				>
				<button
					v-if="searchQuery"
					type="button"
					:aria-label="t('liked.searchClear')"
					class="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
					@click="clearSearch"
				>
					<Icon icon="lucide:x" class="w-4 h-4" />
				</button>
			</div>

			<p v-if="pagination" class="text-sm text-gray-500 mb-4">
				{{ t("liked.countLabel", { count: pagination.total }) }}
			</p>

			<p v-if="unlikeFailed" class="text-sm text-red-500 dark:text-red-400 mb-4" role="alert">
				{{ t("liked.unlikeFailed") }}
			</p>

			<div v-if="items.length" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				<div
					v-for="post in items"
					:key="post.id"
					class="relative group rounded-xl border border-gray-100 dark:border-gray-800 hover:border-pink-200 dark:hover:border-pink-800 hover:shadow-md transition-all duration-200"
				>
					<NuxtLink
						:to="`/posts/${post.slug}`"
						class="block p-4 rounded-xl"
					>
						<h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100 group-hover:text-pink-600 dark:group-hover:text-pink-400 transition-colors line-clamp-2">
							{{ post.title }}
						</h2>
						<div class="mt-2 flex items-center gap-2 text-xs text-gray-500">
							<span v-if="post.author" class="inline-flex items-center gap-1">
								<img
									v-if="post.author.avatar_url"
									:src="post.author.avatar_url"
									:alt="post.author.display_name"
									class="w-3.5 h-3.5 rounded-full object-cover"
								>
								<Icon v-else icon="lucide:user" class="w-3 h-3" />
								{{ post.author.display_name }}
							</span>
							<span v-if="post.category" class="inline-flex items-center gap-1">
								<Icon icon="lucide:folder" class="w-3 h-3" />
								{{ post.category.name }}
							</span>
							<span>{{ post.likes }} {{ t("liked.likeCount") }}</span>
						</div>
					</NuxtLink>

					<!-- Unlike in place (DEC-415, TASK-433): the page's one management
					     control — taking a like back without visiting the post. -->
					<button
						type="button"
						:disabled="unlikingIds.has(post.id)"
						:aria-busy="unlikingIds.has(post.id)"
						:title="t('liked.unlike')"
						:aria-label="t('liked.unlike')"
						class="absolute top-3 right-3 p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:text-pink-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-default"
						@click="handleUnlike(post)"
					>
						<Icon
							:icon="unlikingIds.has(post.id) ? 'lucide:loader-circle' : 'lucide:heart-off'"
							class="w-4 h-4"
						/>
					</button>
				</div>
			</div>

			<!-- Empty state: a search with no matches names the term and offers a
			     one-click clear-search reset; a genuinely empty list browses posts. -->
			<div v-else class="text-center py-12">
				<Icon
					:icon="searching ? 'lucide:search-x' : 'lucide:heart'"
					class="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3"
				/>
				<template v-if="searching">
					<p class="text-gray-500">{{ t("liked.emptySearch", { q: searchQuery.trim() }) }}</p>
					<button
						type="button"
						class="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
						@click="clearSearch"
					>
						<Icon icon="lucide:x" class="w-4 h-4" />
						{{ t("liked.clearSearch") }}
					</button>
				</template>
				<template v-else>
					<p class="text-gray-500">{{ t("liked.empty") }}</p>
					<NuxtLink
						to="/"
						class="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
					>
						<Icon icon="lucide:home" class="w-4 h-4" />
						{{ t("liked.emptyAction") }}
					</NuxtLink>
				</template>
			</div>

			<!-- Pagination (windowed with ellipsis, follows/home pattern) -->
			<div
				v-if="pagination && pagination.total_pages > 1"
				class="flex items-center justify-center gap-2 mt-8"
				role="navigation"
				:aria-label="t('liked.title')"
			>
				<button
					v-for="(pg, i) in paginationTokens"
					:key="pg === '…' ? `ellipsis-${i}` : pg"
					type="button"
					:disabled="pg === '…' || pg === page"
					:aria-current="pg !== '…' && pg === page ? 'page' : undefined"
					:class="[
						'w-9 h-9 rounded-xl text-sm font-medium transition-all duration-200',
						pg === '…'
							? 'cursor-default text-gray-400 dark:text-gray-500'
							: pg === page
								? 'bg-pink-600 text-white shadow-md shadow-pink-500/20 cursor-default'
								: 'border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800',
					]"
					@click="pg !== '…' && pg !== page && goToPage(pg)"
				>
					{{ pg }}
				</button>
			</div>
		</template>
	</div>
</template>
