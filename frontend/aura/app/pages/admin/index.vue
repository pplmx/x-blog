<!--
  Admin Dashboard Page
  Migrated from Next.js /app/admin/page.tsx to Nuxt 4 / Vue 3.
  Fetches posts, categories, and tags in parallel for an overview dashboard.
-->
<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { AdminComment, AdminCommentListResponse } from "~~/api/admin/comments";
import { approveAdminComment } from "~~/api/admin/comments";
import type { AdminPost, AdminPostListResponse } from "~~/api/admin/posts";
import type { Category, Tag } from "~~/api/contracts/shared";
import type { BlogStats } from "~~/api/public/stats";
// biome-ignore lint/correctness/noUnusedImports: used from the template — biome cannot resolve Vue script-setup template bindings (vue-tsc verifies).
import { parseApiDate } from "~~/composables/apiDate";

definePageMeta({ layout: "admin" });

const { t, locale } = useLang();
const config = useRuntimeConfig();
const apiBase = (config.public.apiUrl || "").replace(/\/+$/, "");

useHead({ title: computed(() => t("admin.dashboard.seoTitle")) });

// Client-side data load. The admin layout hides this page's slot on the server
// (auth is localStorage-only), so the page mounts client-side after hydration;
// Nuxt's top-level `await useFetch` does not populate data in that client-only
// mount (the in-flight request is aborted during the hydration recount). Load
// imperatively after mount to fix the hard-reload empty dashboard (ISS-032),
// while keeping SSR gating so admin payload never reaches SSR HTML.
const posts = ref<AdminPost[]>([]);
const categories = ref<Category[] | null>(null);
const tags = ref<Tag[] | null>(null);
const allComments = ref<AdminComment[]>([]);
const blogStats = ref<BlogStats | null>(null);
const loading = ref(true);
// A failed load (expired admin token → 401, transient network, a post page
// error) must be surfaced as an explicit error branch with a retry, not
// silently render all-zero stat cards that look like an empty installation.
const loadError = ref(false);

// Reading-trend analytics (DEC-086): per-day view totals + top posts by
// in-period views. Null when the endpoint failed — the card then hides.
interface ViewsTrend {
	days: number;
	total: number;
	series: Array<{ day: string; views: number }>;
	top_posts: Array<{ id: number; title: string; slug: string; views: number }>;
}
const viewsTrend = ref<ViewsTrend | null>(null);
// Follow analytics (DEC-144, TASK-184): per-series/category reader follow
// counts + totals (tracking-based, notify-independent). Null on failure.
interface FollowStats {
	total_series_follows: number;
	total_category_follows: number;
	top_series: Array<{ id: number; title: string; slug: string; count: number }>;
	top_categories: Array<{ id: number; name: string; count: number }>;
}
const followStats = ref<FollowStats | null>(null);
const followMax = computed(() =>
	Math.max(
		1,
		...(followStats.value?.top_series.map((s) => s.count) ?? []),
		...(followStats.value?.top_categories.map((c) => c.count) ?? []),
	),
);
function followPct(count: number): number {
	return Math.round((count / followMax.value) * 100);
}
// Search-term analytics (DEC-152/TASK-188): top public search counts.
interface SearchTerm {
	query: string;
	count: number;
}
const topSearches = ref<SearchTerm[] | null>(null);
const searchMax = computed(() => Math.max(1, ...(topSearches.value?.map((s) => s.count) ?? [])));
function searchPct(count: number): number {
	return Math.round((count / searchMax.value) * 100);
}
// Comment activity analytics (DEC-154/TASK-189): engagement axis.
interface CommentActivity {
	days: number;
	total: number;
	series: Array<{ day: string; count: number }>;
	top_posts: Array<{ id: number; title: string; slug: string; count: number }>;
}
const commentActivity = ref<CommentActivity | null>(null);
const commentMax = computed(() =>
	Math.max(1, ...(commentActivity.value?.series.map((d) => d.count) ?? [])),
);
function commentPct(count: number): number {
	return Math.round((count / commentMax.value) * 100);
}
function commentDayShort(iso: string): string {
	const [, m, d] = iso.split("-");
	return `${Number(m)}/${Number(d)}`;
}
const trendMax = computed(() =>
	Math.max(1, ...(viewsTrend.value?.series.map((s) => s.views) ?? [])),
);
function trendPct(views: number): number {
	return Math.round((views / trendMax.value) * 100);
}
function trendDayShort(iso: string): string {
	// "2026-08-22" → "8/22" (locale-agnostic compact axis label).
	const [, m, d] = iso.split("-");
	return `${Number(m)}/${Number(d)}`;
}

function authHeaders(): Record<string, string> {
	const token = typeof localStorage !== "undefined" ? localStorage.getItem("admin_token") : null;
	return token ? { Authorization: `Bearer ${token}` } : {};
}

async function loadDashboard(): Promise<void> {
	loadError.value = false;
	try {
		// Load ALL posts via the authenticated admin endpoint (all statuses:
		// published + draft + scheduled), paginating because the API caps a
		// single page at 100. Previously the dashboard used the PUBLIC
		// /api/posts?limit=100 endpoint — published-only and hard-capped, so
		// top/recency/category rankings under-reported on blogs >100 posts and
		// drafts never surfaced (RIL TASK-077, ISS-046).
		const batchSize = 100;
		const postsPage: AdminPost[] = [];
		let page = 1;
		for (;;) {
			const res = await $fetch<AdminPostListResponse>(`${apiBase}/api/admin/posts`, {
				query: { page, limit: batchSize },
				headers: authHeaders(),
			});
			postsPage.push(...res.items);
			if (postsPage.length >= res.pagination.total) break;
			page += 1;
		}
		const [
			catData,
			tagData,
			commentsData,
			statsData,
			trendData,
			followsData,
			searchesData,
			commentsActivityData,
		] = await Promise.all([
			$fetch<Category[]>(`${apiBase}/api/admin/categories`, { headers: authHeaders() }),
			$fetch<Tag[]>(`${apiBase}/api/admin/tags`, { headers: authHeaders() }),
			$fetch<AdminCommentListResponse>(`${apiBase}/api/admin/comments`, {
				query: { page: 1, limit: 100 },
				headers: authHeaders(),
			}),
			$fetch<BlogStats>(`${apiBase}/api/stats`),
			// Reading-trend analytics (DEC-086): best-effort — a failure just
			// hides the trend card rather than blocking the whole dashboard.
			$fetch<ViewsTrend>(`${apiBase}/api/admin/stats/views?days=30`, {
				headers: authHeaders(),
			}).catch(() => null),
			// Follow analytics (DEC-144/TASK-184): best-effort.
			$fetch<FollowStats>(`${apiBase}/api/admin/stats/follows`, {
				headers: authHeaders(),
			}).catch(() => null),
			// Search-term analytics (DEC-152/TASK-188): best-effort.
			$fetch<SearchTerm[]>(`${apiBase}/api/admin/stats/searches`, {
				headers: authHeaders(),
			}).catch(() => null),
			// Comment activity (DEC-154/TASK-189): best-effort.
			$fetch<CommentActivity>(`${apiBase}/api/admin/stats/comments`, {
				headers: authHeaders(),
			}).catch(() => null),
		]);
		posts.value = postsPage;
		categories.value = catData;
		tags.value = tagData;
		allComments.value = commentsData.items;
		blogStats.value = statsData;
		viewsTrend.value = trendData;
		followStats.value = followsData;
		topSearches.value = searchesData;
		commentActivity.value = commentsActivityData;
	} catch {
		// Keep every list empty and flag the failure — the error branch below
		// explains what happened and offers a retry instead of presenting zeros
		// as a real (empty) install (deep-dive finding).
		posts.value = [];
		categories.value = null;
		tags.value = null;
		allComments.value = [];
		blogStats.value = null;
		loadError.value = true;
	} finally {
		loading.value = false;
	}
}
onMounted(() => {
	loadDashboard();
});

// Data export is a superuser-only capability — hidden for editors (DEC-054,
// TASK-116). The API itself enforces this (get_current_superuser); this is a
// UI affordance so an editor never sees a section that would 403. Defaults to
// visible and downgrades only on a confirmed editor role so a failed /me
// response never hides export from a superuser.
const canExport = ref(true);
onMounted(async () => {
	try {
		const data = await $fetch<{ role: string }>(`${apiBase}/api/admin/me`, {
			headers: authHeaders(),
		}).catch(() => null);
		if (data && data.role === "editor") canExport.value = false;
	} catch {
		/* keep visible default */
	}
});

const exporting = ref<"posts" | "comments" | null>(null);
const exportError = ref("");

// Export options (RIL TASK-079, ISS-048): posts status + both kinds' date
// range, passed as query params to the CSV endpoints.
const exportStatus = ref<"all" | "published" | "draft" | "scheduled">("all");
const exportApproved = ref<"all" | "approved" | "pending">("all");
const exportDateFrom = ref("");
const exportDateTo = ref("");

async function downloadExport(kind: "posts" | "comments"): Promise<void> {
	exporting.value = kind;
	exportError.value = "";
	try {
		const q = new URLSearchParams();
		if (kind === "posts" && exportStatus.value !== "all") {
			q.set("status", exportStatus.value);
		}
		if (kind === "comments") {
			if (exportApproved.value === "approved") q.set("is_approved", "true");
			else if (exportApproved.value === "pending") q.set("is_approved", "false");
		}
		if (exportDateFrom.value) q.set("date_from", exportDateFrom.value);
		if (exportDateTo.value) q.set("date_to", exportDateTo.value);
		const qs = q.toString();
		const url = `${apiBase}/api/export/${kind}.csv${qs ? `?${qs}` : ""}`;

		const res = await $fetch<unknown>(url, {
			headers: { Accept: "text/csv", ...authHeaders() },
		});
		// $fetch auto-parses unknown content-type as text; coerce to string.
		const csv = res as string;
		const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
		const urlObj = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = urlObj;
		a.download = `${kind}.csv`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(urlObj);
	} catch (e) {
		exportError.value = e instanceof Error ? e.message : String(e);
	} finally {
		exporting.value = null;
	}
}

// Full-blog backup & restore (DEC-082, TASK-153): superuser-only like the CSV
// export. Download fetches the whole blog as one JSON snapshot; restore
// uploads such a snapshot and upserts it into this instance (natural keys +
// import_key idempotency).
const backupState = ref<"idle" | "downloading" | "restoring">("idle");
const backupError = ref("");
const restoreSummary = ref("");

function backupCounts(counts: Record<string, number>): string {
	// Compact "分类 +1 · 标签 +2 · 文章 +2 · 评论 +2 (跳过 0)" summary.
	return [
		`${t("admin.dashboard.stats.categories")} +${counts.categories ?? 0}`,
		`${t("admin.dashboard.stats.tags")} +${counts.tags ?? 0}`,
		`${t("admin.dashboard.stats.posts")} +${counts.posts_created ?? 0}`,
		`评论 +${counts.comments_created ?? 0} (跳过 ${counts.comments_skipped ?? 0})`,
	].join(" · ");
}

async function downloadFullBackup(): Promise<void> {
	backupState.value = "downloading";
	backupError.value = "";
	restoreSummary.value = "";
	try {
		// Fetched as JSON and re-stringified, so the downloaded file is a
		// canonical snapshot regardless of the wire formatting.
		const data = await $fetch<Record<string, unknown>>(`${apiBase}/api/admin/backup`, {
			headers: authHeaders(),
		});
		const blob = new Blob([JSON.stringify(data, null, 2)], {
			type: "application/json;charset=utf-8",
		});
		const urlObj = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = urlObj;
		a.download = `x-blog-backup-${new Date().toISOString().slice(0, 10)}.json`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(urlObj);
	} catch (e) {
		backupError.value = e instanceof Error ? e.message : String(e);
	} finally {
		backupState.value = "idle";
	}
}

async function onRestoreFileChange(event: Event): Promise<void> {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	if (!file) return;
	backupState.value = "restoring";
	backupError.value = "";
	restoreSummary.value = "";
	try {
		let snap: unknown;
		try {
			snap = JSON.parse(await file.text());
		} catch {
			throw new Error(t("admin.dashboard.backup.parseError"));
		}
		const counts = await $fetch<Record<string, number>>(`${apiBase}/api/admin/backup/restore`, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...authHeaders() },
			body: JSON.stringify(snap),
		});
		restoreSummary.value = backupCounts(counts);
		void loadDashboard(); // refresh the stats cards with restored content
	} catch (e) {
		backupError.value = e instanceof Error ? e.message : String(e);
	} finally {
		backupState.value = "idle";
		input.value = "";
	}
}

const publishedCount = computed(
	() => blogStats.value?.published_posts ?? posts.value.filter((p) => p.published).length,
);
// Draft = total minus published minus scheduled. The backend only excludes
// future-publish_at posts from published_posts, so subtracting it alone would
// fold scheduled posts into the draft bucket (they're a distinct third status).
const draftCount = computed(
	() =>
		(blogStats.value?.total_posts ?? posts.value.length) -
		publishedCount.value -
		(blogStats.value?.scheduled_posts ?? 0),
);
const totalViews = computed(
	() => blogStats.value?.total_views ?? posts.value.reduce((sum, p) => sum + (p.views || 0), 0),
);
const pendingComments = computed(() => allComments.value.filter((c) => !c.is_approved));
const pendingCommentsCount = computed(
	() => blogStats.value?.pending_comments ?? pendingComments.value.length,
);

// Recent 5 published posts sorted by date (newest first)
const recentPosts = computed(() =>
	posts.value
		.filter((p) => p.published)
		.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
		.slice(0, 5),
);

// Top 5 posts by view count
const topPosts = computed(() => [...posts.value].sort((a, b) => (b.views || 0) - (a.views || 0)));
const topPostsTop = computed(() => topPosts.value.slice(0, 5));
// Max views among the shown top posts — the bar scale (guard divide-by-zero).
const maxTopViews = computed(() => Math.max(1, ...topPostsTop.value.map((p) => p.views || 0)));
function topViewsPct(views: number): number {
	return Math.round((views / maxTopViews.value) * 100);
}

// Top 5 pending comments (newest first)
const recentPendingComments = computed(() => pendingComments.value.slice(0, 5));

// Helper: count published posts per category (matches Next.js CategoryPieChart)
function postsInCategory(catId: number): number {
	return posts.value.filter((p) => p.category_id === catId && p.published).length;
}

const approveError = ref<string | null>(null);
// Per-comment in-flight set so an approve/reject click disables THAT row's
// buttons while the request runs (prevents double-submit) without freezing the
// whole dashboard (deep-dive finding).
const approvingIds = ref<Set<number>>(new Set());

async function handleApprove(commentId: number, approved: boolean) {
	if (approvingIds.value.has(commentId)) return;
	const comment = allComments.value.find((c) => c.id === commentId);
	const previous = comment?.is_approved;
	approvingIds.value = new Set(approvingIds.value).add(commentId);
	approveError.value = null;
	try {
		await approveAdminComment(commentId, approved);
		if (comment) comment.is_approved = approved;
	} catch (e) {
		// Roll the row back to its prior state so a failed toggle doesn't leave
		// the UI claiming a moderation change the server rejected.
		if (comment && typeof previous === "boolean") comment.is_approved = previous;
		approveError.value = e instanceof Error ? e.message : t("admin.dashboard.operationFailed");
	} finally {
		const next = new Set(approvingIds.value);
		next.delete(commentId);
		approvingIds.value = next;
	}
}

const loadedAt = new Date().toLocaleString(locale.value === "zh" ? "zh-CN" : "en-US");

const stats = computed(() => [
	{
		labelKey: "admin.dashboard.stats.posts",
		value: blogStats.value?.total_posts ?? posts.value.length,
		icon: "lucide:file-text",
		color: "text-blue-600",
		bg: "bg-blue-50",
	},
	{
		labelKey: "admin.dashboard.stats.published",
		value: publishedCount.value,
		icon: "lucide:check-circle",
		color: "text-green-600",
		bg: "bg-green-50",
	},
	{
		labelKey: "admin.dashboard.stats.draft",
		value: draftCount.value,
		icon: "lucide:clock",
		color: "text-yellow-600",
		bg: "bg-yellow-50",
	},
	{
		labelKey: "admin.dashboard.stats.categories",
		value: categories.value?.length || 0,
		icon: "lucide:folder",
		color: "text-purple-600",
		bg: "bg-purple-50",
	},
	{
		labelKey: "admin.dashboard.stats.tags",
		value: tags.value?.length || 0,
		icon: "lucide:tag",
		color: "text-pink-600",
		bg: "bg-pink-50",
	},
	{
		labelKey: "admin.dashboard.stats.pendingComments",
		value: pendingCommentsCount.value,
		icon: "lucide:message-square",
		color: "text-red-600",
		bg: "bg-red-50",
	},
	{
		labelKey: "admin.dashboard.stats.views",
		value: totalViews.value,
		icon: "lucide:eye",
		color: "text-orange-600",
		bg: "bg-orange-50",
	},
]);
</script>

<template>
  <div>
    <div class="mb-8">
      <h1
        class="text-2xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent"
      >
        {{ t("admin.dashboard.title") }}
      </h1>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
        {{ t("admin.dashboard.subtitle") }}
      </p>
    </div>

    <!-- Data loads client-side after auth (ISS-032); brief loading hint -->
    <div v-if="loading" class="mb-4 text-sm text-gray-500 dark:text-gray-400">
      {{ t("admin.dashboard.loading") }}
    </div>

    <!-- Load failure (401 from an expired admin token, network, an upstream
         error): surface the problem with a retry instead of rendering zeros
         that look like an empty installation (deep-dive finding). -->
    <div
      v-if="loadError"
      class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-5"
      role="alert"
    >
      <div class="flex items-start gap-3">
        <Icon icon="lucide:alert-triangle" class="w-5 h-5 mt-0.5 text-red-500 dark:text-red-400 shrink-0" />
        <div>
          <p class="text-sm font-medium text-red-700 dark:text-red-300">
            {{ t("admin.dashboard.loadError") }}
          </p>
          <p class="text-xs text-red-600/80 dark:text-red-400/80 mt-0.5">
            {{ t("admin.dashboard.loadErrorHint") }}
          </p>
        </div>
      </div>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white bg-red-500 hover:bg-red-600 transition-colors"
        @click="loadDashboard()"
      >
        <Icon icon="lucide:refresh-cw" class="w-3.5 h-3.5" />
        {{ t("common.action.retry") }}
      </button>
    </div>

    <!-- Stats cards (hidden entirely on a failed load — the zeroed cards
         would otherwise masquerade as a real empty install) -->
    <template v-if="!loadError">
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-8">
      <div
        v-for="stat in stats"
        :key="stat.labelKey"
        class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5 hover:shadow-lg hover:border-gray-200 dark:hover:border-gray-700 transition-all duration-200"
      >
        <div class="flex items-center justify-between mb-3">
          <span class="text-sm font-medium text-gray-500 dark:text-gray-400">
            {{ t(stat.labelKey) }}
          </span>
          <div :class="['p-2.5 rounded-xl', stat.bg]">
            <Icon :icon="stat.icon" :class="['h-5 w-5', stat.color]" />
          </div>
        </div>
        <div class="text-3xl font-bold text-gray-900 dark:text-gray-100">
          {{ stat.value }}
        </div>
      </div>
    </div>
    </template>

    <!-- Top posts by views + Category distribution -->
    <div class="grid gap-6 lg:grid-cols-2 mb-8">
      <div class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
          <Icon icon="lucide:file-text" class="w-5 h-5 text-blue-500" />
          {{ t("admin.dashboard.topPosts.title") }}
        </h3>
        <div class="space-y-3">
          <div
            v-for="post in topPostsTop"
            :key="post.id"
            class="p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <div class="flex items-center justify-between mb-1.5 gap-3">
              <span class="font-medium text-gray-900 dark:text-gray-100 truncate">
                {{ post.title }}
              </span>
              <span class="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1 shrink-0">
                <Icon icon="lucide:eye" class="w-4 h-4" />
                {{ post.views || 0 }}
              </span>
            </div>
            <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
              <div
                class="h-2 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all"
                :style="{ width: topViewsPct(post.views || 0) + '%' }"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Category distribution -->
      <div class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
          <Icon icon="lucide:folder" class="w-5 h-5 text-purple-500" />
          {{ t("admin.dashboard.categories.title") }}
        </h3>
        <div class="space-y-3">
          <div
            v-for="cat in categories"
            :key="cat.id"
            class="flex items-center gap-3"
          >
            <span class="text-sm text-gray-700 dark:text-gray-300 w-20 truncate">
              {{ cat.name }}
            </span>
            <div class="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div
                class="bg-purple-500 h-2 rounded-full transition-all"
                :style="{ width: (postsInCategory(cat.id) / (posts.length || 1) * 100) + '%' }"
              />
            </div>
            <span class="text-sm text-gray-500 dark:text-gray-400 w-8 text-right">
              {{ postsInCategory(cat.id) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Follow analytics (DEC-144, TASK-184): what readers track -->
    <div
      v-if="followStats"
      class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5 mb-8"
    >
      <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1 flex items-center gap-2">
        <Icon icon="lucide:heart" class="w-5 h-5 text-rose-500" />
        {{ t("admin.dashboard.follows.title") }}
      </h3>
      <p class="text-xs text-gray-400 mb-4">{{ t("admin.dashboard.follows.note") }}</p>

      <div class="grid gap-4 sm:grid-cols-2 mb-4">
        <div class="rounded-xl border border-gray-100 dark:border-gray-800 p-4">
          <div class="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {{ followStats.total_series_follows }}
          </div>
          <div class="text-xs text-gray-500 mt-1">{{ t("admin.dashboard.follows.totalSeries") }}</div>
        </div>
        <div class="rounded-xl border border-gray-100 dark:border-gray-800 p-4">
          <div class="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {{ followStats.total_category_follows }}
          </div>
          <div class="text-xs text-gray-500 mt-1">{{ t("admin.dashboard.follows.totalCategories") }}</div>
        </div>
      </div>

      <div class="grid gap-6 lg:grid-cols-2">
        <div>
          <h4 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            {{ t("admin.dashboard.follows.topSeries") }}
          </h4>
          <div v-if="followStats.top_series.length" class="space-y-3">
            <div v-for="s in followStats.top_series" :key="s.id" class="flex items-center gap-3">
              <span class="text-sm text-gray-800 dark:text-gray-200 w-32 truncate" :title="s.title">
                {{ s.title }}
              </span>
              <div class="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                <div
                  class="bg-rose-500 h-2 rounded-full transition-all"
                  :style="{ width: followPct(s.count) + '%' }"
                />
              </div>
              <span class="text-sm text-gray-500 w-8 text-right">{{ s.count }}</span>
            </div>
          </div>
          <p v-else class="text-sm text-gray-400">{{ t("admin.dashboard.follows.emptySeries") }}</p>
        </div>
        <div>
          <h4 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            {{ t("admin.dashboard.follows.topCategories") }}
          </h4>
          <div v-if="followStats.top_categories.length" class="space-y-3">
            <div v-for="c in followStats.top_categories" :key="c.id" class="flex items-center gap-3">
              <span class="text-sm text-gray-800 dark:text-gray-200 w-32 truncate">{{ c.name }}</span>
              <div class="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                <div
                  class="bg-rose-500 h-2 rounded-full transition-all"
                  :style="{ width: followPct(c.count) + '%' }"
                />
              </div>
              <span class="text-sm text-gray-500 w-8 text-right">{{ c.count }}</span>
            </div>
          </div>
          <p v-else class="text-sm text-gray-400">{{ t("admin.dashboard.follows.emptyCategories") }}</p>
        </div>
      </div>
    </div>

    <!-- Search-term analytics (DEC-152, TASK-188): what readers look for -->
    <div
      v-if="topSearches"
      class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5 mb-8"
    >
      <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1 flex items-center gap-2">
        <Icon icon="lucide:search" class="w-5 h-5 text-sky-500" />
        {{ t("admin.dashboard.searches.title") }}
      </h3>
      <p class="text-xs text-gray-400 mb-4">{{ t("admin.dashboard.searches.note") }}</p>

      <div v-if="topSearches.length" class="space-y-3">
        <div v-for="s in topSearches" :key="s.query" class="flex items-center gap-3">
          <span class="text-sm text-gray-800 dark:text-gray-200 w-48 truncate" :title="s.query">
            {{ s.query }}
          </span>
          <div class="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
            <div
              class="bg-sky-500 h-2 rounded-full transition-all"
              :style="{ width: searchPct(s.count) + '%' }"
            />
          </div>
          <span class="text-sm text-gray-500 w-8 text-right">{{ s.count }}</span>
        </div>
      </div>
      <p v-else class="text-sm text-gray-400">{{ t("admin.dashboard.searches.empty") }}</p>
    </div>

    <!-- Comment activity (DEC-154, TASK-189): engagement axis -->
    <div
      v-if="commentActivity"
      class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5 mb-8"
    >
      <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
        <Icon icon="lucide:message-square" class="w-5 h-5 text-emerald-500" />
        {{ t("admin.dashboard.comments.title") }}
        <span class="ml-auto text-sm font-normal text-gray-500">
          {{ t("admin.dashboard.comments.total", { n: commentActivity.total }) }}
        </span>
      </h3>
      <div class="flex items-end gap-1 h-24">
        <div
          v-for="point in commentActivity.series"
          :key="point.day"
          class="flex-1 flex items-end justify-center h-full group"
          :title="`${point.day} · ${point.count}`"
        >
          <div
            class="w-full rounded-t bg-gradient-to-t from-emerald-500 to-teal-400 group-hover:from-emerald-600 group-hover:to-teal-500 transition-colors"
            :style="{ height: commentPct(point.count) + '%' }"
          />
        </div>
      </div>
      <div class="flex justify-between text-[10px] text-gray-400 mt-1">
        <span>{{ commentDayShort(commentActivity.series[0]?.day ?? "") }}</span>
        <span>{{ commentDayShort(commentActivity.series[commentActivity.series.length - 1]?.day ?? "") }}</span>
      </div>
      <div
        v-if="commentActivity.top_posts.length"
        class="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800"
      >
        <p class="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
          {{ t("admin.dashboard.comments.topTitle") }}
        </p>
        <ul class="space-y-1">
          <li
            v-for="cp in commentActivity.top_posts"
            :key="cp.id"
            class="flex items-center justify-between gap-3 text-sm"
          >
            <NuxtLink :to="`/admin/posts/${cp.id}`" class="truncate text-gray-700 dark:text-gray-300 hover:text-blue-600">
              {{ cp.title }}
            </NuxtLink>
            <span class="text-gray-400 text-xs flex items-center gap-1 shrink-0">
              <Icon icon="lucide:message-square" class="w-3.5 h-3.5" />
              {{ cp.count }}
            </span>
          </li>
        </ul>
      </div>
    </div>

    <!-- Reading trend (DEC-086): last-30-days view series + top posts -->
    <div
      v-if="viewsTrend"
      class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5 mb-8"
    >
      <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
        <Icon icon="lucide:trending-up" class="w-5 h-5 text-blue-500" />
        {{ t("admin.dashboard.trend.title") }}
        <span class="ml-auto text-sm font-normal text-gray-500">
          {{ t("admin.dashboard.trend.total", { n: viewsTrend.total }) }}
        </span>
      </h3>
      <div class="flex items-end gap-1 h-24">
        <div
          v-for="point in viewsTrend.series"
          :key="point.day"
          class="flex-1 flex items-end justify-center h-full group"
          :title="`${point.day} · ${point.views}`"
        >
          <div
            class="w-full rounded-t bg-gradient-to-t from-blue-500 to-indigo-400 group-hover:from-blue-600 group-hover:to-indigo-500 transition-colors"
            :style="{ height: trendPct(point.views) + '%' }"
          />
        </div>
      </div>
      <div class="flex justify-between text-[10px] text-gray-400 mt-1">
        <span>{{ trendDayShort(viewsTrend.series[0]?.day ?? "") }}</span>
        <span>{{ trendDayShort(viewsTrend.series[viewsTrend.series.length - 1]?.day ?? "") }}</span>
      </div>
      <div
        v-if="viewsTrend.top_posts.length"
        class="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800"
      >
        <p class="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
          {{ t("admin.dashboard.trend.topTitle") }}
        </p>
        <ul class="space-y-1">
          <li
            v-for="tp in viewsTrend.top_posts"
            :key="tp.id"
            class="flex items-center justify-between gap-3 text-sm"
          >
            <NuxtLink :to="`/admin/posts/${tp.id}`" class="truncate text-gray-700 dark:text-gray-300 hover:text-blue-600">
              {{ tp.title }}
            </NuxtLink>
            <span class="text-gray-400 text-xs flex items-center gap-1 shrink-0">
              <Icon icon="lucide:eye" class="w-3.5 h-3.5" />
              {{ tp.views }}
            </span>
          </li>
        </ul>
      </div>
    </div>

    <!-- Recent posts + Pending comments -->
    <div class="grid gap-6 lg:grid-cols-2 mb-8">
      <!-- Recent posts -->
      <div class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
          <Icon icon="lucide:clock" class="w-5 h-5 text-green-500" />
          {{ t("admin.dashboard.recentPosts.title") }}
        </h3>
        <div v-if="recentPosts.length === 0" class="text-gray-500 dark:text-gray-400 text-sm">
          {{ t("admin.dashboard.recentPosts.empty") }}
        </div>
        <div v-else class="space-y-2">
          <NuxtLink
            v-for="post in recentPosts"
            :key="post.id"
            :to="`/admin/posts/${post.id}`"
            class="flex items-center justify-between p-4 rounded-xl hover:bg-gradient-to-r hover:from-blue-50 hover:to-indigo-50 dark:hover:from-blue-900/10 dark:hover:to-indigo-900/10 transition-colors group"
          >
            <div>
              <p
                class="font-medium text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors"
              >
                {{ post.title }}
              </p>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                {{ parseApiDate(post.created_at)?.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US") ?? "" }}
              </p>
            </div>
            <div class="flex items-center gap-3 text-sm text-gray-400 dark:text-gray-500">
              <span class="flex items-center gap-1">
                <Icon icon="lucide:eye" class="w-4 h-4" />
                {{ post.views || 0 }}
              </span>
              <span v-if="post.comment_count" class="flex items-center gap-1">
                <Icon icon="lucide:message-square" class="w-4 h-4" />
                {{ post.comment_count }}
              </span>
            </div>
          </NuxtLink>
        </div>
      </div>

      <!-- Pending comments -->
      <div class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
          <Icon icon="lucide:message-square" class="w-5 h-5 text-red-500" />
          {{ t("admin.dashboard.pendingComments.title") }}
          <span v-if="pendingComments.length > 0" class="ml-auto text-sm font-normal text-gray-500">
            {{ t("admin.dashboard.pendingComments.count", { n: pendingComments.length }) }}
          </span>
        </h3>
        <div
          v-if="approveError"
          class="mb-4 px-4 py-3 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-600 dark:text-red-400"
        >
          {{ approveError }}
        </div>
        <div v-if="recentPendingComments.length === 0" class="text-gray-500 dark:text-gray-400 text-sm">
          {{ t("admin.dashboard.pendingComments.empty") }}
        </div>
        <div v-else class="space-y-3">
          <div
            v-for="comment in recentPendingComments"
            :key="comment.id"
            class="p-3 rounded-xl bg-red-50/50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/20"
          >
            <div class="flex items-start justify-between mb-2">
              <div class="text-sm">
                <span class="font-medium text-gray-900 dark:text-gray-100">{{ comment.nickname }}</span>
                <span class="text-gray-400 mx-1">·</span>
                <NuxtLink :to="`/admin/comments`" class="text-blue-500 hover:text-blue-600">
                  {{ comment.post_title }}
                </NuxtLink>
              </div>
            </div>
            <p class="text-sm text-gray-600 dark:text-gray-400 mb-2 line-clamp-2">
              {{ comment.content }}
            </p>
            <div class="flex items-center gap-2">
              <button
                type="button"
                :disabled="approvingIds.has(comment.id)"
                class="px-3 py-1 text-xs font-medium text-green-700 bg-green-100 dark:bg-green-900/30 dark:text-green-400 rounded-lg hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                @click="handleApprove(comment.id, true)"
              >
                {{ approvingIds.has(comment.id) ? t("admin.dashboard.approving") : t("admin.dashboard.approve") }}
              </button>
              <button
                type="button"
                :disabled="approvingIds.has(comment.id)"
                class="px-3 py-1 text-xs font-medium text-red-700 bg-red-100 dark:bg-red-900/30 dark:text-red-400 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                @click="handleApprove(comment.id, false)"
              >
                {{ t("admin.dashboard.reject") }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Data export (superuser-only, hidden for editors) -->
    <div
      v-if="canExport"
      class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5 mb-8"
    >
      <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
        <Icon icon="lucide:download" class="w-5 h-5 text-indigo-500" />
        {{ t("admin.dashboard.export.title") }}
      </h3>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
        {{ t("admin.dashboard.export.subtitle") }}
      </p>
      <div v-if="exportError" class="mb-4 px-4 py-3 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-600 dark:text-red-400">
        {{ exportError }}
      </div>

      <!-- Export filters (RIL TASK-079) -->
      <div class="flex flex-wrap items-end gap-3 mb-4">
        <label class="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          {{ t("admin.dashboard.export.postStatus") }}
          <select
            v-model="exportStatus"
            class="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">{{ t("admin.dashboard.export.allStatuses") }}</option>
            <option value="published">{{ t("admin.dashboard.export.published") }}</option>
            <option value="draft">{{ t("admin.dashboard.export.draft") }}</option>
            <option value="scheduled">{{ t("admin.dashboard.export.scheduled") }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          {{ t("admin.dashboard.export.commentStatus") }}
          <select
            v-model="exportApproved"
            class="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">{{ t("admin.dashboard.export.allStatuses") }}</option>
            <option value="approved">{{ t("admin.dashboard.export.approved") }}</option>
            <option value="pending">{{ t("admin.dashboard.export.pending") }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          {{ t("admin.dashboard.export.fromDate") }}
          <input
            v-model="exportDateFrom"
            type="date"
            class="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
        </label>
        <label class="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          {{ t("admin.dashboard.export.toDate") }}
          <input
            v-model="exportDateTo"
            type="date"
            class="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
        </label>
      </div>

      <div class="flex flex-wrap gap-3">
        <button
          type="button"
          :disabled="exporting !== null"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-indigo-500 to-blue-500 hover:from-indigo-600 hover:to-blue-600 disabled:opacity-60 transition-all"
          @click="downloadExport('posts')"
        >
          <Icon icon="lucide:file-text" class="w-4 h-4" />
          {{ exporting === 'posts' ? t("admin.dashboard.export.exporting") : t("admin.dashboard.export.posts") }}
        </button>
        <button
          type="button"
          :disabled="exporting !== null"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 disabled:opacity-60 transition-all"
          @click="downloadExport('comments')"
        >
          <Icon icon="lucide:message-square" class="w-4 h-4" />
          {{ exporting === 'comments' ? t("admin.dashboard.export.exporting") : t("admin.dashboard.export.comments") }}
        </button>
      </div>
    </div>

    <!-- Full-blog backup & restore (DEC-082) -->
    <div
      v-if="canExport"
      class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5 mb-8"
    >
      <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
        <Icon icon="lucide:archive" class="w-5 h-5 text-amber-500" />
        {{ t("admin.dashboard.backup.title") }}
      </h3>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
        {{ t("admin.dashboard.backup.subtitle") }}
      </p>
      <div
        v-if="backupError"
        class="mb-4 px-4 py-3 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-600 dark:text-red-400"
      >
        {{ backupError }}
      </div>
      <div
        v-if="restoreSummary"
        class="mb-4 px-4 py-3 rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 text-sm text-green-700 dark:text-green-400"
      >
        {{ t("admin.dashboard.backup.restored", { summary: restoreSummary }) }}
      </div>
      <div class="flex flex-wrap gap-3">
        <button
          type="button"
          :disabled="backupState !== 'idle'"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-60 transition-all"
          @click="downloadFullBackup"
        >
          <Icon icon="lucide:download" class="w-4 h-4" />
          {{ backupState === 'downloading' ? t("admin.dashboard.backup.downloading") : t("admin.dashboard.backup.download") }}
        </button>
        <label
          class="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-slate-500 to-slate-700 hover:from-slate-600 hover:to-slate-800 disabled:opacity-60 transition-all cursor-pointer"
          :class="{ 'opacity-60 pointer-events-none': backupState !== 'idle' }"
        >
          <Icon icon="lucide:upload" class="w-4 h-4" />
          {{ backupState === 'restoring' ? t("admin.dashboard.backup.restoring") : t("admin.dashboard.backup.restore") }}
          <input
            type="file"
            accept="application/json,.json"
            class="hidden"
            :disabled="backupState !== 'idle'"
            @change="onRestoreFileChange"
          >
        </label>
      </div>
    </div>

    <!-- Data freshness -->
    <div class="text-xs text-gray-400 dark:text-gray-600 text-right">
      {{ t("admin.dashboard.updatedAt", { time: loadedAt }) }}
    </div>
  </div>
</template>
