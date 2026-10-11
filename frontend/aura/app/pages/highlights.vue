<script setup lang="ts">
// /highlights — the signed-in reader's saved passages (round 466, DEC-511 /
// TASK-583). Cloud-only: guests are redirected to /login with a return path,
// like the likes page. Each row links back to its post and exposes inline
// note editing + delete.
import { onMounted, ref, watch } from "vue";

import {
	deleteReaderHighlight,
	getReaderHighlights,
	updateReaderHighlightNote,
	type ReaderHighlight,
} from "~~/api/reader/highlights";
import { parseApiDate } from "~~/composables/apiDate";
import { useReaderAuth } from "~~/composables/useReaderAuth";
import { useSeo } from "~~/composables/useSeo";

const { t, locale } = useLang();
const router = useRouter();
const loginTarget = { path: "/login", query: { redirect: "/highlights" } } as const;
const { isAuthenticated } = useReaderAuth();

useSeo(() => ({ title: t("highlights.seoTitle"), description: t("highlights.seoDesc"), path: "/highlights" }));

const items = ref<ReaderHighlight[]>([]);
const loading = ref(true);
const error = ref("");
const editingId = ref<number | null>(null);
const editNote = ref("");

async function load() {
	loading.value = true;
	error.value = "";
	try {
		const data = await getReaderHighlights(1, 100);
		items.value = data.items;
	} catch {
		error.value = "loadFailed";
	} finally {
		loading.value = false;
	}
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

watch(isAuthenticated, (authed) => {
	if (authed) {
		void load();
	} else {
		items.value = [];
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

		<div v-else-if="items.length === 0" class="text-center py-16 text-gray-500 dark:text-gray-400">
			<p class="text-lg">{{ t("highlights.empty") }}</p>
			<p class="mt-1 text-sm">{{ t("highlights.emptyHint") }}</p>
		</div>

		<ul v-else class="space-y-4">
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
	</div>
</template>
