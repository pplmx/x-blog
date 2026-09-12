<script setup lang="ts">
/**
 * Reader follows-feed page (DEC-292, TASK-375).
 *
 * The home page caps "Latest from your follows" at 12 posts with no way to
 * browse the rest; this page is the full, paginated feed of every new post
 * from the reader's followed categories + series + tags. Auth-scoped like the
 * notifications inbox: guests are redirected to /login, and a stale session
 * drops back to the same sign-in route instead of showing a broken private
 * list.
 */
import { computed, onMounted, watch } from "vue";
import type { PaginationInfo, PostList } from "~~/api/contracts/shared";
import { getReaderFollowsFeed } from "~~/api/reader/follows";
import { scrollToPageTop } from "~~/composables/scrollToTop";
import { paginationPages } from "~~/composables/usePagination";
import { useReaderAuth } from "~~/composables/useReaderAuth";
import { useSeo } from "~~/composables/useSeo";

const { t } = useLang();
const route = useRoute();
const router = useRouter();
const { isAuthenticated, logout, isStaleSession } = useReaderAuth();

useSeo(() => ({
	title: t("follows.seoTitle"),
	description: t("follows.seoDesc"),
	path: "/follows",
}));

// Page comes from the query string so pagination is deep-linkable and
// shareable; `navigateTo` with a `?page=` query drives the refetch below.
// A malformed `?page=abc` parses to NaN — treat it as page 1 instead of
// sending `?page=NaN` to the API (a guaranteed 422, review finding).
const page = computed(() => {
	const raw = route.query.page ? Number.parseInt(String(route.query.page), 10) : 1;
	return Number.isNaN(raw) ? 1 : raw;
});

const items = ref<PostList[]>([]);
const pending = ref(true);
const loadFailed = ref(false);
const pagination = ref<PaginationInfo | null>(null);

// Windowed, ellipsis-aware pagination buttons (same pattern as home/search/
// archive): a reader following a lot can't get a button per page.
const paginationTokens = computed(() =>
	paginationPages(pagination.value?.total_pages ?? 0, page.value),
);

// The feed is auth-scoped: a stale page deep link (e.g. /follows?page=999
// after follows changed) would otherwise render the empty state while earlier
// pages still hold content — clamp back to the last real page once known
// (home/search/archive pattern, deep-dive finding ISS-308).
watch(
	() => pagination.value,
	(p) => {
		const requested = page.value;
		if (!p || Number.isNaN(requested) || requested < 2) return;
		const last = p.total_pages ?? 1;
		if (requested > last && last >= 1) {
			// replace (not push): a stale deep link like /follows?page=99 must
			// not leave itself in history — Back from the clamped page would
			// re-land on the out-of-range URL and re-clamp (archive-page
			// parity).
			void navigateTo({ query: { page: String(last) } }, { replace: true });
		}
	},
);

async function load() {
	if (!isAuthenticated.value) return;
	pending.value = true;
	loadFailed.value = false;
	try {
		const res = await getReaderFollowsFeed(12, page.value);
		items.value = res?.items ?? [];
		pagination.value = res?.pagination ?? null;
		// Keep the skeleton up while an out-of-range page is being clamped:
		// the first (empty) response here lands BEFORE the clamp watch
		// redirects, so clearing pending in a finally would flash the empty
		// state at a reader who is following things (review finding, DEC-292).
		// The clamp's follow-up navigation re-runs load() with pending true,
		// which settles on the last real page.
		const p = res?.pagination;
		const requested = page.value;
		if (!p || Number.isNaN(requested) || requested < 2) {
			pending.value = false;
		} else {
			const last = p.total_pages ?? 1;
			// Stay pending while an out-of-range request is about to be clamped
			// (the clamp refetch re-enters load() and settles); settle normally
			// when already in range.
			pending.value = requested > last && last >= 1;
		}
	} catch (cause) {
		// A stale session is not a transient outage: drop the dead token and
		// send the reader back to sign-in (notifications-page parity) instead of
		// showing a misleading "couldn't load" block under a dead privacy scope.
		if (isStaleSession(cause)) {
			logout();
			void router.replace("/login");
			return;
		}
		items.value = [];
		pagination.value = null;
		loadFailed.value = true;
		pending.value = false;
	}
}

// Refetch when the reader turns the page (query change), so pagination works
// as an in-app SPA navigation without a full reload.
watch([page], () => {
	if (isAuthenticated.value) void load();
});

onMounted(() => {
	if (!isAuthenticated.value) {
		void router.replace("/login");
		return;
	}
	void load();
});

// The feed is auth-scoped: when the reader signs out in the header while on
// this page, clear the shown state and send them to the same /login the guest
// guard and stale-session path use (notifications-page parity).
watch(isAuthenticated, (authed) => {
	if (authed) return;
	items.value = [];
	pagination.value = null;
	pending.value = false;
	loadFailed.value = false;
	void router.replace("/login");
});

function goToPage(pg: number | string) {
	void navigateTo({ query: { page: pg === 1 ? undefined : String(pg) } });
	scrollToPageTop();
}

function retry() {
	void load();
}
</script>

<template>
	<div class="max-w-4xl mx-auto px-4 py-8 sm:py-12">
		<div class="flex items-center gap-3 mb-6">
			<span class="text-emerald-600 dark:text-emerald-400">
				<Icon icon="lucide:rss" class="w-7 h-7" />
			</span>
			<div>
				<h1 class="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
					{{ t("follows.title") }}
				</h1>
				<p class="text-gray-500 dark:text-gray-400 mt-1 text-sm">
					{{ t("follows.subtitle") }}
				</p>
			</div>
		</div>

		<!-- Load failure: a failed fetch must NOT fall through to the empty
		     state and be mistaken for "no follows" — surface it with a retry. -->
		<div v-if="loadFailed" class="text-center py-12">
			<p class="text-gray-500" role="alert">{{ t("follows.loadFailed") }}</p>
			<button
				type="button"
				class="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
				@click="retry"
			>
				<Icon icon="lucide:refresh-cw" class="w-4 h-4" />
				{{ t("follows.retry") }}
			</button>
		</div>

		<!-- Loading skeleton -->
		<div v-else-if="pending" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			<div
				v-for="i in 6"
				:key="i"
				class="h-24 rounded-xl border border-gray-100 dark:border-gray-800 animate-pulse"
			/>
		</div>

		<template v-else>
			<p v-if="pagination" class="text-sm text-gray-400 mb-4">
				{{ t("follows.countLabel", { count: pagination.total }) }}
			</p>

			<div v-if="items.length" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				<NuxtLink
					v-for="post in items"
					:key="post.id"
					:to="`/posts/${post.slug}`"
					class="group p-4 rounded-xl border border-gray-100 dark:border-gray-800 hover:border-emerald-200 dark:hover:border-emerald-800 hover:shadow-md transition-all duration-200"
				>
					<h2 class="text-sm font-semibold text-gray-900 dark:text-gray-100 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors line-clamp-2">
						{{ post.title }}
					</h2>
					<div class="mt-2 flex items-center gap-2 text-xs text-gray-400">
						<span v-if="post.category" class="inline-flex items-center gap-1">
							<Icon icon="lucide:folder" class="w-3 h-3" />
							{{ post.category.name }}
						</span>
						<span v-if="post.series" class="inline-flex items-center gap-1">
							<Icon icon="lucide:layers" class="w-3 h-3" />
							{{ post.series.title }}
						</span>
						<span>{{ post.views }} {{ t("home.posts.views") }}</span>
					</div>
				</NuxtLink>
			</div>

			<!-- Empty state -->
			<div v-else class="text-center py-12">
				<Icon icon="lucide:rss" class="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
				<p class="text-gray-500">{{ t("follows.empty") }}</p>
				<NuxtLink
					to="/categories"
					class="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
				>
					<Icon icon="lucide:folder-open" class="w-4 h-4" />
					{{ t("follows.emptyAction") }}
				</NuxtLink>
			</div>

			<!-- Pagination (windowed with ellipsis, matching home/search/archive) -->
			<div
				v-if="pagination && pagination.total_pages > 1"
				class="flex items-center justify-center gap-2 mt-8"
				role="navigation"
				:aria-label="t('follows.title')"
			>
				<button
					v-for="(pg, i) in paginationTokens"
					:key="pg === '…' ? `ellipsis-${i}` : pg"
					type="button"
					:disabled="pg === '…' || pg === pagination.page"
					:aria-current="pg !== '…' && pg === pagination.page ? 'page' : undefined"
					:aria-label="pg !== '…' ? t('follows.paginationAnnounce', { page: String(pg) }) : undefined"
					:class="[
						'px-3 py-1 rounded transition-colors',
						pg === '…'
							? 'cursor-default text-gray-400'
							: pg === pagination.page
								? 'bg-emerald-600 text-white cursor-default'
								: 'border hover:bg-gray-50',
					]"
					@click="pg !== '…' && pg !== pagination.page && goToPage(pg)"
				>
					{{ pg }}
				</button>
			</div>
		</template>
	</div>
</template>
