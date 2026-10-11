<script setup lang="ts">
// /highlights — the signed-in reader's saved passages (round 466, DEC-511 /
// TASK-583). Cloud-only: guests are redirected to /login with a return path,
// like the likes page. Each row links back to its post and exposes inline
// note editing + delete. Paginated like the follows/liked feed: the page comes
// from ?page= so it is deep-linkable, and the list is windowed+ellipsis aware
// (a reader with >100 highlights is otherwise stranded on the first page).
import { computed, onMounted, ref, watch } from "vue";

import {
	deleteReaderHighlight,
	getReaderHighlights,
	updateReaderHighlightNote,
	type ReaderHighlight,
} from "~~/api/reader/highlights";
import type { PaginationInfo } from "~~/api/contracts/shared";
import { parseApiDate } from "~~/composables/apiDate";
import { paginationPages } from "~~/composables/usePagination";
import { useReaderAuth } from "~~/composables/useReaderAuth";
import { useSeo } from "~~/composables/useSeo";

const { t, locale } = useLang();
const route = useRoute();
const router = useRouter();
const loginTarget = { path: "/login", query: { redirect: "/highlights" } } as const;
const { isAuthenticated } = useReaderAuth();

useSeo(() => ({ title: t("highlights.seoTitle"), description: t("highlights.seoDesc"), path: "/highlights" }));

// Page from the query string (deep-linkable); malformed/too-low values resolve
// to page 1 instead of a guaranteed 422 loop (follows/liked pattern).
const page = computed(() => {
	const raw = route.query.page ? Number.parseInt(String(route.query.page), 10) : 1;
	return Number.isNaN(raw) || raw < 1 ? 1 : raw;
});

const items = ref<ReaderHighlight[]>([]);
const loading = ref(true);
const error = ref("");
const pagination = ref<PaginationInfo | null>(null);
const editingId = ref<number | null>(null);
const editNote = ref("");
// Monotonic request sequence so a slow earlier page response can never
// overwrite a newer one (follows/liked parity).
let loadSeq = 0;

// Windowed, ellipsis-aware pagination buttons (home/search/follows pattern).
const paginationTokens = computed(() => paginationPages(pagination.value?.total_pages ?? 0, page.value));
// Screen-reader announcement: the list swaps in place when paging (home/archive pattern).
const pageAnnouncement = computed(() => t("common.state.pageAnnounce", { page: page.value }));

// Clamp a stale deep link (?page=99 after highlights changed) back to the last
// real page instead of rendering a false empty state (follows/liked parity).
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
	const seq = ++loadSeq;
	loading.value = true;
	error.value = "";
	try {
		const data = await getReaderHighlights(page.value, 50);
		if (seq !== loadSeq) return; // a newer request wins
		items.value = data.items;
		pagination.value = {
			total: data.total,
			page: data.page ?? page.value,
			limit: data.limit ?? 50,
			total_pages: data.total_pages ?? 0,
		};
	} catch {
		if (seq !== loadSeq) return;
		error.value = "loadFailed";
	} finally {
		if (seq === loadSeq) loading.value = false;
	}
}

function goToPage(pg: number | string) {
	void navigateTo({ query: { page: pg === 1 ? undefined : String(pg) } });
	window.scrollTo({ top: 0 });
}

function retry() {
	void load();
}

function startEdit(hl: ReaderHighlight) {
	editingId.value = hl.id;
	editNote.value = hl.note ?? "";
}

async function saveNote(hl: ReaderHighlight) {
	error.value = "";
	try {
		const updated = await updateReaderHighlightNote(hl.id, editNote.value.trim());
		Object.assign(hl, updated);
	} catch {
		error.value = "saveFailed";
	}
	editingId.value = null;
}

async function remove(hl: ReaderHighlight) {
	if (!confirm(t("highlights.deleteConfirm"))) return;
	error.value = "";
	try {
		await deleteReaderHighlight(hl.id);
		items.value = items.value.filter((x) => x.id !== hl.id);
	} catch {
		error.value = "deleteFailed";
	}
}

function formatDate(value: string | null): string {
	const d = parseApiDate(value);
	if (!d) return "";
	return d.toLocaleDateString(locale.value === "zh" ? "zh-CN" : "en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

onMounted(() => {
	if (!isAuthenticated.value) {
		void router.replace(loginTarget);
		return;
	}
	void load();
});

watch(page, () => {
	if (isAuthenticated.value) void load();
});

watch(isAuthenticated, (authed) => {
	if (authed) {
		void load();
	} else {
		items.value = [];
		pagination.value = null;
		void router.replace(loginTarget);
	}
});
</script>

<template>
	<div class="mx-auto max-w-3xl px-4 py-12">
		<header class="mb-8">
			<h1 class="text-3xl font-bold text-gray-900 dark:text-gray-100">{{ t("highlights.title") }}</h1>
			<p class="mt-2 text-gray-500 dark:text-gray-400">{{ t("highlights.subtitle") }}</p>
		</header>

		<p v-if="error" role="alert" class="mb-4 text-sm text-red-500">
			{{ t(`highlights.${error}`) }}
		</p>

		<div v-if="loading" class="text-center py-12 text-gray-400">{{ t("highlights.loading") }}</div>

		<div v-else-if="error === 'loadFailed'" class="text-center py-16">
			<p class="text-gray-500" role="alert">{{ t("highlights.loadFailed") }}</p>
			<button
				type="button"
				class="mt-4 inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
				@click="retry"
			>
				<Icon icon="lucide:refresh-cw" class="h-4 w-4" />
				{{ t("highlights.retry") }}
			</button>
		</div>

		<div v-else-if="items.length === 0" class="text-center py-16 text-gray-500 dark:text-gray-400">
			<p class="text-lg">{{ t("highlights.empty") }}</p>
			<p class="mt-1 text-sm">{{ t("highlights.emptyHint") }}</p>
		</div>

		<template v-else>
			<span role="status" aria-live="polite" class="sr-only">{{ pageAnnouncement }}</span>
			<p v-if="pagination" class="mb-4 text-sm text-gray-400">
				{{ t("highlights.countLabel", { count: pagination.total }) }}
			</p>

			<ul class="space-y-4">
			<li
				v-for="hl in items"
				:key="hl.id"
				class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900"
			>
				<div class="flex items-start justify-between gap-3">
					<div>
						<NuxtLink
							:to="hl.post ? `/posts/${hl.post.slug}` : undefined"
							class="text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400"
						>
							{{ hl.post?.title ?? t("highlights.unknownPost") }}
						</NuxtLink>
						<p class="mt-2 border-l-2 border-yellow-300 pl-3 text-sm italic text-gray-700 dark:border-yellow-800 dark:text-gray-200">
							{{ hl.text }}
						</p>
						<p class="mt-2 text-xs text-gray-400">{{ formatDate(hl.created_at) }}</p>
					</div>
					<button
						type="button"
						class="shrink-0 rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
						@click="remove(hl)"
					>
						{{ t("highlights.delete") }}
					</button>
				</div>

				<div v-if="editingId === hl.id" class="mt-3 flex items-center gap-2">
					<input
						v-model="editNote"
						type="text"
						maxlength="1000"
						:placeholder="t('highlights.notePlaceholder')"
						class="flex-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800"
					/>
					<button
						type="button"
						class="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
						@click="saveNote(hl)"
					>
						{{ t("highlights.save") }}
					</button>
					<button
						type="button"
						class="px-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
						@click="editingId = null"
					>
						{{ t("highlights.cancel") }}
					</button>
				</div>
				<div v-else class="mt-2 flex items-center gap-2 text-sm">
					<span v-if="hl.note" class="text-gray-600 dark:text-gray-300">{{ hl.note }}</span>
					<button
						type="button"
						class="text-xs text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
						@click="startEdit(hl)"
					>
						{{ hl.note ? t("highlights.editNote") : t("highlights.addNote") }}
					</button>
				</div>
			</li>
			</ul>

			<!-- Pagination (windowed with ellipsis, matching home/search/follows) -->
			<div
				v-if="pagination && pagination.total_pages > 1"
				class="mt-8 flex items-center justify-center gap-2"
				role="navigation"
				:aria-label="t('highlights.title')"
			>
				<button
					v-for="(pg, i) in paginationTokens"
					:key="pg === '…' ? `ellipsis-${i}` : pg"
					type="button"
					:disabled="pg === '…' || pg === page"
					:aria-current="pg !== '…' && pg === page ? 'page' : undefined"
					:aria-label="
						pg !== '…' ? t('highlights.paginationAnnounce', { page: String(pg) }) : undefined
					"
					:class="[
						'rounded px-3 py-1 transition-colors',
						pg === '…'
							? 'cursor-default text-gray-400'
							: pg === page
								? 'cursor-default bg-emerald-600 text-white'
								: 'border hover:bg-gray-50 dark:hover:bg-gray-900',
					]"
					@click="pg !== '…' && pg !== page && goToPage(pg)"
				>
					{{ pg }}
				</button>
			</div>
		</template>
	</div>
</template>
