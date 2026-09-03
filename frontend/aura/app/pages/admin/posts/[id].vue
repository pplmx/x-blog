<script setup lang="ts">
import { onBeforeRouteLeave } from "vue-router";
import type { AdminPostDetail, PostCreate, PostRevisionSummary } from "~~/api/admin/posts";
import {
	createAdminPost,
	getPostRevisions,
	restorePostRevision,
	updateAdminPost,
	useAdminPost,
} from "~~/api/admin/posts";
import { notifyPushSubscribers } from "~~/api/admin/push";
import { useAdminSeries } from "~~/api/admin/series";
import { useAdminCategories, useAdminTags } from "~~/api/admin/taxonomy";

definePageMeta({ layout: "admin" });

const { t } = useLang();

useHead({ title: computed(() => t("admin.postEdit.seoTitle")) });

const route = useRoute();
const isNew = route.params.id === "new";
const postId = isNew ? null : Number.parseInt(route.params.id as string, 10);

const formData = ref<Partial<PostCreate>>({
	title: "",
	slug: "",
	content: "",
	excerpt: "",
	published: false,
	pinned: false,
	publish_at: null,
	category_id: undefined,
	tag_ids: [],
	cover_image: undefined,
	series_id: undefined,
	series_order: 0,
});
const isSubmitting = ref(false);
const submitError = ref<string | null>(null);
// Web Push notify-subscribers (DEC-055, TASK-118): only offered on published
// posts; superuser-only on the backend, but the button simply surfaces the
// backend's 403 if this account is an editor.
const isNotifying = ref(false);
const notifyMessage = ref<string | null>(null);
// A message box must know whether it holds a success or a failure so it can be
// styled accordingly — a fixed green box shipped failure strings in green
// (deep-dive finding). True when the latest notify attempt failed.
const notifyFailed = ref(false);

// Draft auto-save (RIL TASK-190, DEC-156): edits are auto-persisted to a
// draft after a debounce, with a visible saving/saved state and no lost work
// on leave. Reuses the same create/update admin endpoint as manual save.
const AUTOSAVE_DEBOUNCE_MS = 800;
type AutoSaveStatus = "idle" | "saving" | "saved" | "error";
const autoSaveStatus = ref<AutoSaveStatus>("idle");
const autoSaveError = ref<string | null>(null);
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let autosaveInFlight = false;
let autosaveQueued = false;
/** True while a route-leave flush is running: the "point the address bar at
 * the created draft" redirect must then be skipped — we're already navigating
 * somewhere else, and calling navigateTo mid-leave fights the pending nav. */
let isLeavingRoute = false;
/** Id of the draft created from a /admin/posts/new session (postId is null). */
let autosavedId: number | null = null;

// Version history (DEC-158, TASK-191): per-post saved snapshots, list +
// restore. Only meaningful for an existing post.
const revisions = ref<PostRevisionSummary[]>([]);
const revisionsOpen = ref(false);
const revisionsLoading = ref(false);
const revisionsError = ref<string | null>(null);
const restoringId = ref<number | null>(null);
const revisionMessage = ref<string | null>(null);
// Mirrors notifyFailed: green for restore success, red for a failed restore.
const revisionFailed = ref(false);

// Unsaved-changes guard state (RIL TASK-061). Declared before the postData
// watch below, whose immediate:true callback needs loadedSnapshot at setup time.
const isDirty = ref(false);
let loadedSnapshot = "";
function snapshot(): string {
	return JSON.stringify(formData.value);
}
const categories = ref<Array<{ id: number; name: string }>>([]);
const tags = ref<Array<{ id: number; name: string }>>([]);
const series = ref<Array<{ id: number; title: string; slug: string }>>([]);
const existingPost = ref<AdminPostDetail | null>(null);

const { data: catsData, error: catsError, refresh: refreshCategories } = await useAdminCategories();
const { data: tagsData, error: tagsError, refresh: refreshTags } = await useAdminTags();
// Series list for the membership dropdown (DEC-056/TASK-123). The admin keeps
// the option to create series on the /admin/series page; here a post is simply
// assigned into an existing series with a 0-based position.
const { data: seriesData, error: seriesError, refresh: refreshSeries } = await useAdminSeries();

// A failed taxonomy fetch must NOT silently leave empty pickers (the author
// would assign nothing believing the lists were empty) — surface it + retry.
const taxonomyFailed = computed(
	() => !!catsError.value || !!tagsError.value || !!seriesError.value,
);
function retryTaxonomy() {
	void refreshCategories();
	void refreshTags();
	void refreshSeries();
}

watch(
	() => catsData.value,
	(val) => {
		if (val) categories.value = val;
	},
	{ immediate: true },
);
watch(
	() => tagsData.value,
	(val) => {
		if (val) tags.value = val;
	},
	{ immediate: true },
);
watch(
	() => seriesData.value,
	(val) => {
		if (val) series.value = val;
	},
	{ immediate: true },
);

const {
	data: postData,
	pending: postPending,
	error: postError,
	refresh: postRefresh,
} = postId
	? await useAdminPost(postId)
	: {
			data: ref(null) as any,
			pending: ref(false) as any,
			error: ref(null) as any,
			refresh: (() => {}) as any,
		};

watch(
	() => postData.value,
	(val) => {
		if (val) {
			existingPost.value = val;
			formData.value = {
				title: val.title || "",
				slug: val.slug || "",
				content: val.content || "",
				excerpt: val.excerpt || "",
				published: val.published,
				pinned: val.pinned,
				publish_at: toLocalInputValue(val.publish_at),
				category_id: val.category_id || undefined,
				tag_ids: val.tag_ids || [],
				cover_image: val.cover_image || undefined,
				series_id: val.series_id || undefined,
				series_order: val.series_order ?? 0,
			};
			loadedSnapshot = snapshot();
			isDirty.value = false;
		}
	},
	{ immediate: true },
);

function generateSlug(title: string): string {
	let slug = title
		.toLowerCase()
		.replace(/[^\w\s-]/g, "")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "")
		.trim();
	// ASCII-only `\w` (regex without the `u` flag) strips CJK characters, so a
	// Chinese-only title collapses to "" (or a bare "-"), which violates the
	// backend slug pattern ^[a-z0-9]+(?:-[a-z0-9]+)*$ and 422s new-post saves.
	// Fall back to a deterministic ASCII slug so a pure-CJK "fill title +
	// content, save" flow always works (RIL TASK-106, ISS-086).
	if (!slug) {
		let hash = 0;
		for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) & 0x7fffffff;
		slug = `post-${hash.toString(36)}`;
	}
	return slug;
}

// publish_at round-trip helpers. The backend stores/publishes publish_at as a
// naive-UTC datetime (see crud.utc_now_naive), while the datetime-local input
// edits in the browser's local wall-clock. These convert between the two so a
// scheduled time is the same instant regardless of the admin's timezone
// (RIL TASK-072, ISS-040).
function toLocalInputValue(utcIso: string | null): string {
	if (!utcIso) return "";
	// Backend returns naive UTC (no zone suffix). Treat it as UTC so the
	// browser converts to the admin's local wall-clock for editing.
	const d = new Date(utcIso.endsWith("Z") || utcIso.includes("+") ? utcIso : `${utcIso}Z`);
	if (Number.isNaN(d.getTime())) return "";
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toUtcNaiveIso(localValue: string): string {
	if (!localValue) return "";
	// datetime-local yields local wall-clock; Date interprets it as local and
	// toISOString() converts to UTC. Truncate to minute precision to match the
	// input granularity and keep the naive-UTC storage contract.
	const d = new Date(localValue);
	if (Number.isNaN(d.getTime())) return "";
	return `${d.toISOString().slice(0, 16)}:00`;
}

// Clearing the series membership drops the order back to 0 (a standalone post
// must not carry a stale position into the payload — DEC-056/TASK-123).
watch(
	() => formData.value.series_id,
	(val) => {
		if (val === undefined || val === null) formData.value.series_order = 0;
	},
);

// Track edits against the loaded snapshot and warn on tab-close/reload
// (beforeunload) and SPA navigation (route leave) so a long draft is never
// lost silently (RIL TASK-061). isDirty/loadedSnapshot/snapshot are declared
// above with the other state.
watch(
	formData,
	() => {
		if (loadedSnapshot !== "" && snapshot() !== loadedSnapshot) {
			isDirty.value = true;
			scheduleAutosave();
		}
	},
	{ deep: true },
);

/** Debounce a pending auto-save so bursts of keystrokes coalesce into one. */
function scheduleAutosave() {
	if (autosaveTimer) clearTimeout(autosaveTimer);
	autosaveTimer = setTimeout(() => {
		autosaveTimer = null;
		void runAutosave();
	}, AUTOSAVE_DEBOUNCE_MS);
}

/**
 * Persist the current form to a draft without an explicit save. For a brand
 * new post (postId null) the first auto-save creates the draft via the normal
 * create endpoint; later auto-saves update it. Newer edits that arrive while a
 * save is in flight are queued and re-run so the latest state is never lost.
 */
async function runAutosave() {
	if (autosaveInFlight) {
		autosaveQueued = true;
		return;
	}
	if (isSubmitting.value || isNotifying.value) return;
	if (!isDirty.value) return;

	// Snapshot the form exactly as it's about to be persisted (all of this is
	// synchronous, so the form cannot change between this capture and the
	// payload spread below). On completion we reload from THIS capture, not the
	// live form: keystrokes typed while the request was in flight were never
	// persisted, and loading snapshot() would wrongly clear dirty and mark that
	// lost tail as "saved" — disabling the beforeunload/route-leave guards too
	// (regression found in the deep-dive re-audit).
	const startedSnapshot = snapshot();

	const payload = { ...formData.value } as Partial<PostCreate>;
	// publish_at is "" when unset (edit-mode round-trip) — normalize to null so
	// the backend datetime field doesn't 422 (RIL TASK-190).
	payload.publish_at = payload.publish_at ? toUtcNaiveIso(payload.publish_at) : null;
	// Snapshot of exactly what we're about to persist, used below to decide
	// whether it's safe to point the address bar at the created draft.
	const savedSnapshot = JSON.stringify(payload);

	let targetId: number | null = postId;
	if (targetId === null) {
		// First auto-save of a new post: need a draft to exist first. Skip
		// until there's a title (so we can derive the required ASCII slug) —
		// an empty new form has nothing worth persisting.
		targetId = autosavedId;
		if (targetId === null) {
			if (!payload.title) return;
			if (!payload.slug) payload.slug = generateSlug(payload.title);
			if (!payload.slug) return;
		}
	}

	autosaveInFlight = true;
	autoSaveStatus.value = "saving";
	autoSaveError.value = null;
	try {
		// These commands resolve to the created/updated post id on success and
		// reject with a FetchError (whose .data.detail carries 422 messages) on
		// failure, so no .data.value/.error.value ref reading is needed.
		const created =
			targetId === null
				? await createAdminPost(payload as PostCreate)
				: await updateAdminPost(targetId, payload);
		const createdId = created.id;
		if (targetId === null && createdId !== null) {
			autosavedId = createdId;
			// Point the address bar at the newly created draft so a manual
			// refresh doesn't re-create a second draft — but only when the
			// form still matches what we just saved, so a remount can't drop
			// keystrokes that arrived while the request was in flight, and
			// never during a route-leave flush (we're already navigating away;
			// redirecting mid-leave would fight the pending navigation).
			if (snapshot() === savedSnapshot && !isLeavingRoute) {
				navigateTo(`/admin/posts/${createdId}`, { replace: true });
			}
		}
		loadedSnapshot = startedSnapshot;
		// Recompute dirty against what was actually persisted: any edits that
		// arrived mid-flight remain dirty so the debounce/queue flushes them and
		// the unload guards stay armed. The queued re-run then flips the status.
		isDirty.value = snapshot() !== startedSnapshot;
		autoSaveStatus.value = isDirty.value ? "saving" : "saved";
	} catch (err) {
		const detail = (err as { data?: { detail?: string } } | null)?.data?.detail;
		autoSaveError.value = typeof detail === "string" ? detail : t("admin.postEdit.autoSaveError");
		autoSaveStatus.value = "error";
	} finally {
		autosaveInFlight = false;
		if (autosaveQueued) {
			autosaveQueued = false;
			if (autosaveTimer) clearTimeout(autosaveTimer);
			void runAutosave();
		}
	}
}

function onBeforeUnload(e: BeforeUnloadEvent) {
	// Best-effort flush on unload; the native prompt below still guards the
	// (already-saved) state and lets the author choose not to lose anything.
	if (isDirty.value) void runAutosave();
	if (isDirty.value) {
		e.preventDefault();
		e.returnValue = ""; // legacy browsers show native prompt
	}
}

onMounted(() => {
	// The native close/refresh guard MUST apply to every post, existing or new:
	// hard-refreshing an edited, previously-saved draft is the highest-value
	// save path and was previously unprotected (the guard only registered for
	// new posts — deep-dive finding). Existing posts get their snapshot in the
	// postData watch; new posts snapshot the empty form here.
	if (!postId) loadedSnapshot = snapshot();
	window.addEventListener("beforeunload", onBeforeUnload);
});

onBeforeUnmount(() => {
	if (autosaveTimer) clearTimeout(autosaveTimer);
	window.removeEventListener("beforeunload", onBeforeUnload);
});

onBeforeRouteLeave(async () => {
	// Cancel explicitly discards in-memory edits: no flush, no prompt.
	if (discardRequested.value) return true;
	if (!isDirty.value) return true;
	// Otherwise persist before leaving and AWAIT the result — a flush that fails
	// (network blip / 422) must not silently drop the draft past the route
	// change. Only when the save genuinely did not land do we ask.
	isLeavingRoute = true;
	if (autosaveTimer) clearTimeout(autosaveTimer);
	await runAutosave();
	if (isDirty.value) {
		// The flush didn't clear dirty (it failed or couldn't run): surface the
		// loss the fire-and-forget version hid. Fall back to allowing the
		// departure when confirm is unavailable (non-browser / test harness).
		return typeof window !== "undefined" && typeof window.confirm === "function"
			? window.confirm(t("admin.postEdit.confirmDiscard"))
			: true;
	}
	return true;
});

async function handleSubmit(e: Event) {
	e.preventDefault();
	isSubmitting.value = true;
	submitError.value = null;

	const payload = { ...formData.value };
	// publish_at is "" when unset (edit-mode round-trip); normalize to null so
	// the backend datetime field doesn't 422 on save/update (RIL TASK-190).
	payload.publish_at = payload.publish_at ? toUtcNaiveIso(payload.publish_at) : null;
	// New posts start with an empty slug, which fails the backend schema
	// pattern (^[a-z0-9]+(?:-[a-z0-9]+)*$) with a 422. Generate one from the
	// title so a plain "fill title + content, save" flow always works.
	if (isNew && !payload.slug && payload.title) {
		payload.slug = generateSlug(payload.title);
	}

	try {
		// These commands reject with a FetchError on HTTP failure (422 detail
		// lands in .data.detail); success resolves with the persisted post id.
		// A new post whose auto-save already created the draft lives under
		// `autosavedId` — isNew/postId are setup-time consts, so after the
		// address bar was pointed at /admin/posts/{id} this instance still sees
		// postId === null and a plain create would regenerate the identical slug
		// and 400 "Slug already exists" (or duplicate the post with a different
		// slug). Save INTO the autosaved draft instead. (CRITICAL deep-dive)
		const targetId = postId ?? autosavedId;
		if (targetId === null) {
			await createAdminPost(payload as PostCreate);
		} else {
			await updateAdminPost(targetId, payload);
		}
		isDirty.value = false; // don't re-prompt during the redirect
		navigateTo("/admin/posts", { replace: true });
	} catch (err) {
		const detail = (err as { data?: { detail?: string } } | null)?.data?.detail;
		submitError.value = typeof detail === "string" ? detail : t("admin.postEdit.saveError");
	} finally {
		isSubmitting.value = false;
	}
}

// Cancel abandons in-memory edits (route-leave skips the flush when this is
// set), so a mis-clicked save never silently persists accidental changes.
const discardRequested = ref(false);
function handleCancel() {
	discardRequested.value = true;
	navigateTo("/admin/posts", { replace: true });
}

// A published+future publish_at post is "scheduled", matching the list page's
// Scheduled chip — don't let the editor's "Published on" text contradict it.
const isScheduledFuture = computed(() => {
	if (!formData.value.published || !formData.value.publish_at) return false;
	const d = new Date(formData.value.publish_at);
	return !Number.isNaN(d.getTime()) && d.getTime() > Date.now();
});

/** Broadcast a Web Push notification about this published post (DEC-055). */
async function handleNotify() {
	if (!formData.value.published) return;
	notifyMessage.value = null;
	// A published post without a slug can't be deep-linked; say so instead of
	// silently no-oping (deep-dive finding).
	if (!formData.value.slug) {
		notifyFailed.value = true;
		notifyMessage.value = t("admin.postEdit.notifyRequiresSlug");
		return;
	}
	isNotifying.value = true;
	try {
		await notifyPushSubscribers({
			title: formData.value.title || t("admin.postEdit.notifyFallbackTitle"),
			body: formData.value.excerpt || "",
			url: `/posts/${formData.value.slug}`,
		});
		notifyMessage.value = t("admin.postEdit.notifySent");
		notifyFailed.value = false;
	} catch {
		notifyMessage.value = t("admin.postEdit.notifyFailed");
		notifyFailed.value = true;
	} finally {
		isNotifying.value = false;
	}
}

/** Load the saved revision history for the current (existing) post. */
async function loadRevisions() {
	if (postId === null) return;
	revisionsLoading.value = true;
	revisionsError.value = null;
	try {
		revisions.value = await getPostRevisions(postId);
	} catch {
		revisionsError.value = t("admin.postEdit.revisionLoadError");
	} finally {
		revisionsLoading.value = false;
	}
}

function formatRevisionTime(iso: string): string {
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Open/close the version-history panel (lazily loads on first open). */
async function toggleRevisions() {
	if (revisionsOpen.value) {
		revisionsOpen.value = false;
		return;
	}
	revisionsOpen.value = true;
	revisionMessage.value = null;
	await loadRevisions();
}

/** Restore a saved revision as the live post, then reload the form. */
async function handleRestoreRevision(revId: number) {
	if (postId === null || restoringId.value !== null) return;
	// Restoring immediately replaces the form with the revision's state, wiping
	// any in-progress edits — same destructive class as cancel/route-leave, so
	// ask when dirty (deep-dive re-audit finding).
	if (
		isDirty.value &&
		typeof window !== "undefined" &&
		typeof window.confirm === "function" &&
		!window.confirm(t("admin.postEdit.confirmDiscard"))
	) {
		return;
	}
	restoringId.value = revId;
	revisionMessage.value = null;
	try {
		await restorePostRevision(postId, revId);
		revisionMessage.value = t("admin.postEdit.revisionRestored");
		revisionFailed.value = false;
		// Re-fetch the live post so the form reflects the restored state.
		await postRefresh();
		// Refresh the history list (restore also snapshots the pre-restore state).
		await loadRevisions();
	} catch (err) {
		const detail = (err as { data?: { detail?: string } } | null)?.data?.detail;
		revisionMessage.value =
			typeof detail === "string" ? detail : t("admin.postEdit.revisionRestoreError");
		revisionFailed.value = true;
	} finally {
		restoringId.value = null;
	}
}

function toggleTag(tagId: number) {
	const current = formData.value.tag_ids || [];
	if (current.includes(tagId)) {
		formData.value.tag_ids = current.filter((id) => id !== tagId);
	} else {
		formData.value.tag_ids = [...current, tagId];
	}
}

const textareaRef = ref<HTMLTextAreaElement | null>(null);
const showPreview = ref(false);
const { uploadImage, isUploading, error: uploadError } = useUpload();
const showMediaPicker = ref(false);
const showCoverPicker = ref(false);

function insertFromLibrary(url: string) {
	insertMarkdown(`![image](${url})`);
}

function insertCoverFromLibrary(url: string) {
	formData.value.cover_image = url;
}

function insertMarkdown(before: string, after = "") {
	const ta = textareaRef.value;
	if (!ta) return;
	const start = ta.selectionStart;
	const end = ta.selectionEnd;
	const text = formData.value.content || "";
	const selected = text.slice(start, end);
	const replacement = `${before}${selected}${after}`;
	formData.value.content = text.slice(0, start) + replacement + text.slice(end);
	requestAnimationFrame(() => {
		ta.focus();
		ta.selectionStart = ta.selectionEnd = start + replacement.length - after.length;
	});
}

function wrapSelection(prefix: string, suffix: string) {
	insertMarkdown(prefix, suffix);
}

function insertHeading(level: number) {
	const prefix = `${"#".repeat(level)} `;
	insertMarkdown(prefix);
}

function insertLink() {
	const ta = textareaRef.value;
	if (!ta) return;
	const start = ta.selectionStart;
	const end = ta.selectionEnd;
	const text = formData.value.content || "";
	const selected = text.slice(start, end);
	if (selected) {
		formData.value.content = `${text.slice(0, start)}[${selected}](url)${text.slice(end)}`;
		requestAnimationFrame(() => {
			ta.focus();
			ta.selectionStart = start + selected.length + 3;
			ta.selectionEnd = start + selected.length + 6;
		});
	} else {
		insertMarkdown("[", "](url)");
	}
}

async function handleImageUpload(file: File) {
	const url = await uploadImage(file);
	if (url) {
		insertMarkdown(`![image](${url})`);
	}
}

function onPaste(e: ClipboardEvent) {
	const items = e.clipboardData?.items;
	if (!items) return;
	for (const item of items) {
		if (item.type.startsWith("image/")) {
			e.preventDefault();
			const file = item.getAsFile();
			if (file) handleImageUpload(file);
			return;
		}
	}
}

function onDrop(e: DragEvent) {
	const files = e.dataTransfer?.files;
	if (!files || files.length === 0) return;
	for (const file of Array.from(files)) {
		if (file.type.startsWith("image/")) {
			e.preventDefault();
			handleImageUpload(file);
			return;
		}
	}
}

function onDragOver(e: DragEvent) {
	e.preventDefault();
}

function triggerImagePicker() {
	const input = document.getElementById("image-upload-input") as HTMLInputElement | null;
	if (input) input.click();
}

function handleFileInput(e: Event) {
	const input = e.target as HTMLInputElement;
	const file = input.files?.[0];
	if (file) handleImageUpload(file);
	input.value = "";
}
</script>

<template>
  <div class="max-w-4xl">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">
        {{ isNew ? t('admin.postEdit.titleNew') : t('admin.postEdit.titleEdit') }}
      </h1>
      <NuxtLink
        to="/admin/posts"
        class="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
      >
        <Icon icon="lucide:arrow-left" class="w-4 h-4" />
        {{ t("admin.postEdit.backToPosts") }}
      </NuxtLink>
    </div>

    <div v-if="!isNew && postPending" class="text-center py-12">
      <div class="inline-flex items-center gap-2 text-gray-500">
        <svg :aria-label="t('admin.postEdit.loading')" class="animate-spin w-5 h-5" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        {{ t("admin.postEdit.loading") }}
      </div>
    </div>

    <div v-else-if="!isNew && postError" class="text-center py-12 text-red-500">
      <p class="mb-4">{{ postError?.message || t('admin.postEdit.loadErrorFallback') }}</p>
      <button
        type="button"
        class="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        @click="() => postRefresh()"
      >
        {{ t('common.action.retry') }}
      </button>
    </div>

    <form v-else @submit.prevent="handleSubmit" class="space-y-6">
      <!-- Taxonomy load failure: never let the pickers render as empty lists
           when the fetch failed — surface it with a retry (deep-dive finding). -->
      <div
        v-if="taxonomyFailed"
        role="alert"
        class="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-600 dark:text-red-400"
      >
        <span>{{ t('admin.postEdit.taxonomyLoadFailed') }}</span>
        <button
          type="button"
          class="shrink-0 text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
          @click="retryTaxonomy"
        >
          {{ t('common.action.retry') }}
        </button>
      </div>

      <!-- Auto-save status indicator (RIL TASK-190) -->
      <div
        v-if="autoSaveStatus !== 'idle'"
        data-testid="autosave-status"
        :role="autoSaveStatus === 'error' ? 'alert' : 'status'"
        class="flex items-center gap-2 text-sm px-4 py-2.5 rounded-xl border"
        :class="autoSaveStatus === 'saving'
          ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-300'
          : autoSaveStatus === 'saved'
            ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
            : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-600 dark:text-red-400'"
      >
        <Icon
          :icon="autoSaveStatus === 'saving' ? 'lucide:loader-2' : autoSaveStatus === 'saved' ? 'lucide:check-circle-2' : 'lucide:alert-triangle'"
          :class="{ 'animate-spin': autoSaveStatus === 'saving' }"
          class="w-4 h-4"
        />
        <template v-if="autoSaveStatus === 'saving'">{{ t('admin.postEdit.autoSaving') }}</template>
        <template v-else-if="autoSaveStatus === 'saved'">{{ t('admin.postEdit.autoSaved') }}</template>
        <template v-else>{{ autoSaveError || t('admin.postEdit.autoSaveError') }}</template>
      </div>
      <div v-if="submitError" role="alert" class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400">
        {{ submitError }}
      </div>
      <div
        v-if="notifyMessage"
        :role="notifyFailed ? 'alert' : 'status'"
        :class="notifyFailed
          ? 'p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400'
          : 'p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl text-green-700 dark:text-green-300'"
      >
        {{ notifyMessage }}
      </div>

      <!-- Version history (DEC-158, TASK-191) -->
      <div v-if="!isNew" data-testid="revision-history" class="border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden">
        <button
          type="button"
          data-testid="revision-toggle"
          @click="toggleRevisions"
          class="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          <span class="flex items-center gap-2">
            <Icon icon="lucide:history" class="w-4 h-4 text-amber-500" />
            {{ t("admin.postEdit.revisionHistory") }}
          </span>
          <Icon :icon="revisionsOpen ? 'lucide:chevron-up' : 'lucide:chevron-down'" class="w-4 h-4 text-gray-400" />
        </button>
        <div v-if="revisionsOpen" class="border-t border-gray-100 dark:border-gray-800 p-4 space-y-3 bg-gray-50/50 dark:bg-gray-800/40">
          <div
            v-if="revisionMessage"
            data-testid="revision-message"
            :role="revisionFailed ? 'alert' : 'status'"
            :class="revisionFailed
              ? 'text-sm text-red-600 dark:text-red-400'
              : 'text-sm text-green-600 dark:text-green-400'"
          >
            {{ revisionMessage }}
          </div>
          <div v-if="revisionsError" role="alert" class="text-sm text-red-600 dark:text-red-400">{{ revisionsError }}</div>
          <div v-if="revisionsLoading" class="flex items-center gap-2 text-sm text-gray-500">
            <Icon icon="lucide:loader-2" class="w-4 h-4 animate-spin" />
            {{ t("admin.postEdit.revisionLoading") }}
          </div>
          <ul v-else-if="revisions.length > 0" class="space-y-2">
            <li
              v-for="rev in revisions"
              :key="rev.id"
              data-testid="revision-row"
              class="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800"
            >
              <div class="min-w-0">
                <p class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{{ rev.title }}</p>
                <p class="text-xs text-gray-400 dark:text-gray-500">{{ formatRevisionTime(rev.created_at) }}</p>
              </div>
              <button
                type="button"
                :disabled="restoringId !== null"
                class="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg font-medium transition-colors disabled:opacity-50"
                :class="restoringId === rev.id ? 'text-gray-400' : 'text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20'"
                @click="handleRestoreRevision(rev.id)"
              >
                <Icon
                  :icon="restoringId === rev.id ? 'lucide:loader-2' : 'lucide:rotate-ccw'"
                  class="w-3.5 h-3.5"
                  :class="{ 'animate-spin': restoringId === rev.id }"
                />
                {{ t("admin.postEdit.revisionRestore") }}
              </button>
            </li>
          </ul>
          <p v-else class="text-sm text-gray-500 dark:text-gray-400">{{ t("admin.postEdit.revisionEmpty") }}</p>
        </div>
      </div>

      <div class="bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 space-y-5">
        <div>
          <label for="post-title" class="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            <Icon icon="lucide:file-text" class="w-4 h-4 text-blue-500" />
            {{ t("admin.postEdit.title") }} <span class="text-red-500">*</span>
          </label>
          <input
            id="post-title"
            v-model="formData.title"
            type="text"
            required
            :placeholder="t('admin.postEdit.titlePlaceholder')"
            class="w-full text-lg h-12 px-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
          >
          <button
            v-if="!isNew || !formData.slug"
            type="button"
            @click="formData.slug = generateSlug(formData.title || '')"
            class="mt-2 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            {{ t("admin.postEdit.autoSlug") }}
          </button>
        </div>

        <div>
          <label class="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            <Icon icon="lucide:link" class="w-4 h-4 text-gray-400" />
            {{ t("admin.postEdit.slug") }}
          </label>
          <input
            v-model="formData.slug"
            type="text"
            placeholder="article-slug"
            class="w-full font-mono px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
          >
          <p class="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
            {{ t("admin.postEdit.urlPreview", { slug: formData.slug || 'slug' }) }}
          </p>
        </div>

        <div>
          <label for="post-excerpt" class="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            <Icon icon="lucide:align-left" class="w-4 h-4 text-gray-400" />
            {{ t("admin.postEdit.excerpt") }}
          </label>
          <textarea
            id="post-excerpt"
            v-model="formData.excerpt"
            rows="2"
            :placeholder="t('admin.postEdit.excerptPlaceholder')"
            class="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
          />
        </div>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <div class="bg-gradient-to-br from-purple-50 dark:from-purple-900/20 to-white dark:to-gray-900 border border-purple-100 dark:border-purple-900/30 rounded-2xl p-5">
          <label class="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            <Icon icon="lucide:folder" class="w-4 h-4 text-purple-500" />
            {{ t("admin.postEdit.category") }}
          </label>
          <select
            v-model="formData.category_id"
            class="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
          >
            <option :value="undefined">{{ t("admin.postEdit.selectCategory") }}</option>
            <option v-for="cat in categories" :key="cat.id" :value="cat.id">
              {{ cat.name }}
            </option>
          </select>
        </div>

        <div class="bg-gradient-to-br from-pink-50 dark:from-pink-900/20 to-white dark:to-gray-900 border border-pink-100 dark:border-pink-900/30 rounded-2xl p-5">
          <label class="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            <Icon icon="lucide:tag" class="w-4 h-4 text-pink-500" />
            {{ t("admin.postEdit.tags") }}
          </label>
          <div v-if="tags.length > 0" class="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
            <label
              v-for="tag in tags"
              :key="tag.id"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm cursor-pointer transition-all"
              :class="formData.tag_ids?.includes(tag.id)
                ? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-md'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-pink-100 dark:hover:bg-pink-900/50'"
            >
              <input
                type="checkbox"
                class="sr-only"
                :checked="formData.tag_ids?.includes(tag.id) ?? false"
                @change="toggleTag(tag.id)"
              >
              #{{ tag.name }}
            </label>
          </div>
          <p v-else class="text-sm text-gray-400 dark:text-gray-500">{{ t("admin.postEdit.noTags") }}</p>
        </div>

        <div class="bg-gradient-to-br from-indigo-50 dark:from-indigo-900/20 to-white dark:to-gray-900 border border-indigo-100 dark:border-indigo-900/30 rounded-2xl p-5">
          <label class="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            <Icon icon="lucide:layers" class="w-4 h-4 text-indigo-500" />
            {{ t("admin.postEdit.series") }}
          </label>
          <div class="space-y-3">
            <select
              v-model="formData.series_id"
              class="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
            >
              <option :value="undefined">{{ t("admin.postEdit.seriesNone") }}</option>
              <option v-for="s in series" :key="s.id" :value="s.id">
                {{ s.title }}
              </option>
            </select>
            <!-- series_order is only meaningful inside a series; when the admin
                 clears the membership, drop the order back to 0 so a standalone
                 post never carries a stray position -->
            <div class="flex items-center gap-3">
              <label class="text-sm text-gray-600 dark:text-gray-400 shrink-0">
                {{ t("admin.postEdit.seriesOrder") }}
              </label>
              <input
                v-model.number="formData.series_order"
                type="number"
                min="0"
                :disabled="!formData.series_id"
                class="w-28 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
              >
            </div>
          </div>
        </div>
      </div>

      <div class="bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5">
        <div class="flex items-center justify-between mb-3">
          <label for="post-content" class="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
            <Icon icon="lucide:edit-3" class="w-4 h-4 text-blue-500" />
            {{ t("admin.postEdit.contentLabel") }} <span class="text-red-500">*</span>
          </label>
          <button
            type="button"
            @click="showPreview = !showPreview"
            class="text-xs px-3 py-1 rounded-lg transition-colors"
            :class="showPreview
              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'"
          >
            <Icon :icon="showPreview ? 'lucide:edit-3' : 'lucide:eye'" class="w-3.5 h-3.5 inline mr-1" />
            {{ showPreview ? t('admin.postEdit.edit') : t('admin.postEdit.preview') }}
          </button>
        </div>

        <div class="flex items-center gap-1 mb-3 flex-wrap">
          <button type="button" @click="wrapSelection('**', '**')" :title="t('admin.postEdit.toolbar.bold')" :aria-label="t('admin.postEdit.toolbar.bold')" class="toolbar-btn">
            <b>B</b>
          </button>
          <button type="button" @click="wrapSelection('*', '*')" :title="t('admin.postEdit.toolbar.italic')" :aria-label="t('admin.postEdit.toolbar.italic')" class="toolbar-btn italic">
            <i>I</i>
          </button>
          <span class="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1" />
          <button type="button" @click="insertHeading(1)" :title="t('admin.postEdit.toolbar.heading1')" :aria-label="t('admin.postEdit.toolbar.heading1')" class="toolbar-btn">H1</button>
          <button type="button" @click="insertHeading(2)" :title="t('admin.postEdit.toolbar.heading2')" :aria-label="t('admin.postEdit.toolbar.heading2')" class="toolbar-btn">H2</button>
          <button type="button" @click="insertHeading(3)" :title="t('admin.postEdit.toolbar.heading3')" :aria-label="t('admin.postEdit.toolbar.heading3')" class="toolbar-btn">H3</button>
          <span class="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1" />
          <button type="button" @click="insertLink()" :title="t('admin.postEdit.toolbar.link')" :aria-label="t('admin.postEdit.toolbar.link')" class="toolbar-btn">
            <Icon icon="lucide:link" class="w-3.5 h-3.5" />
          </button>
          <button type="button" @click="triggerImagePicker" :disabled="isUploading" :title="t('admin.postEdit.toolbar.uploadImage')" :aria-label="t('admin.postEdit.toolbar.uploadImage')" class="toolbar-btn">
            <Icon :icon="isUploading ? 'lucide:loader-2' : 'lucide:image'" :class="{ 'animate-spin': isUploading }" class="w-3.5 h-3.5" />
          </button>
          <button type="button" @click="showMediaPicker = true" :title="t('admin.postEdit.toolbar.mediaLibrary')" :aria-label="t('admin.postEdit.toolbar.mediaLibrary')" class="toolbar-btn">
            <Icon icon="lucide:images" class="w-3.5 h-3.5" />
          </button>
          <input id="image-upload-input" type="file" accept="image/*" class="hidden" @change="handleFileInput">
          <MediaPickerModal :open="showMediaPicker" @close="showMediaPicker = false" @select="insertFromLibrary" />
        </div>

        <div
          class="relative"
          @dragover="onDragOver"
          @drop="onDrop"
        >
          <div v-if="showPreview" class="grid grid-cols-2 gap-4">
            <textarea
              id="post-content"
              ref="textareaRef"
              v-model="formData.content"
              rows="15"
              required
              :placeholder="t('admin.postEdit.contentPlaceholder')"
              class="w-full font-mono text-sm px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
              @paste="onPaste"
            />
            <div
              class="prose prose-sm dark:prose-invert max-w-none overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4"
            >
              <!-- Preview must render the SAME way the public article does
                   (markdown -> segments -> sanitized HTML), otherwise the
                   editor shows raw markdown source and misleads the author.
                   MarkdownContent (auto-imported) is exactly the component
                   /posts/[slug] uses. (RIL TASK-043, ISS-030) -->
              <MarkdownContent :content="formData.content || ''" />
            </div>
          </div>
          <textarea
            v-else
            id="post-content"
            ref="textareaRef"
            v-model="formData.content"
            rows="15"
            required
            :placeholder="t('admin.postEdit.contentPlaceholder')"
            class="w-full font-mono text-sm px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
            @paste="onPaste"
          />
          <div
            v-if="isUploading"
            class="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 rounded-xl"
          >
            <div class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <Icon icon="lucide:loader-2" class="w-5 h-5 animate-spin" />
              {{ t("admin.postEdit.uploading") }}
            </div>
          </div>
          <div
            v-if="uploadError"
            role="alert"
            class="mt-2 text-xs text-red-500"
          >
            {{ uploadError }}
          </div>
        </div>

        <p class="text-xs text-gray-400 dark:text-gray-500 mt-2">
          {{ t("admin.postEdit.contentHint") }}
        </p>
      </div>

      <div class="bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 space-y-4">
        <div class="flex items-start gap-3">
          <input
            id="published"
            v-model="formData.published"
            type="checkbox"
            class="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 mt-0.5"
          >
          <label for="published" class="cursor-pointer">
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ formData.published ? t('admin.postEdit.publishedOn') : t('admin.postEdit.saveAsDraft') }}
            </span>
            <!-- A published post with a future publish_at is scheduled — mirror
                 the list page's Scheduled chip so the two surfaces agree. -->
            <span
              v-if="isScheduledFuture"
              class="ml-2 text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
            >
              {{ t('admin.postEdit.scheduledBadge') }}
            </span>
          </label>
        </div>

        <div class="flex items-start gap-3">
          <input
            id="pinned"
            v-model="formData.pinned"
            type="checkbox"
            class="w-5 h-5 rounded border-gray-300 text-amber-600 focus:ring-amber-500 mt-0.5"
          >
          <label for="pinned" class="cursor-pointer">
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ formData.pinned ? t('admin.postEdit.pinned') : t('admin.postEdit.pin') }}
            </span>
          </label>
        </div>

        <div class="flex items-start gap-3">
          <input
            id="publish_at"
            v-model="formData.publish_at"
            type="datetime-local"
            class="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
          >
          <label for="publish_at" class="text-sm font-medium text-gray-700 dark:text-gray-300 pt-1.5 whitespace-nowrap">
            {{ t("admin.postEdit.schedulePublish") }}
          </label>
        </div>

        <!-- Scheduled-publish notification note (DEC-076/TASK-235): the blog has
             no background scheduler, so a scheduled post goes live silently —
             followers/Web Push subscribers are NOT notified when publish_at
             crosses. Tell the operator up front so they can notify manually
             (the editor's notify button) instead of discovering the gap after
             the fact. -->
        <p
          v-if="formData.published && formData.publish_at"
          class="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400"
          role="note"
        >
          <Icon icon="lucide:info" class="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" role="presentation" />
          {{ t("admin.postEdit.scheduledNoNotifyHint") }}
        </p>

        <div class="flex items-start gap-3">
          <input
            id="cover_image"
            v-model="formData.cover_image"
            type="text"
            placeholder="https://example.com/image.jpg"
            class="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
          >
          <button
            type="button"
            class="shrink-0 px-2.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            :title="t('admin.postEdit.toolbar.coverFromLibrary')"
            :aria-label="t('admin.postEdit.toolbar.coverFromLibrary')"
            @click="showCoverPicker = true"
          >
            <Icon icon="lucide:images" class="w-4 h-4" />
          </button>
          <label for="cover_image" class="text-sm font-medium text-gray-700 dark:text-gray-300 pt-1.5 whitespace-nowrap">
            {{ t("admin.postEdit.coverImage") }}
          </label>
          <MediaPickerModal :open="showCoverPicker" @close="showCoverPicker = false" @select="insertCoverFromLibrary" />
        </div>
      </div>

      <div class="flex items-center gap-3 pt-2">
        <button
          v-if="formData.published"
          type="button"
          :disabled="isNotifying"
          class="inline-flex items-center gap-2 px-6 py-3 border border-green-300 dark:border-green-700 text-green-700 dark:text-green-300 rounded-xl font-medium hover:bg-green-50 dark:hover:bg-green-900/20 transition-all disabled:opacity-50"
          @click="handleNotify"
        >
          <Icon :icon="isNotifying ? 'lucide:loader-2' : 'lucide:bell-ring'" class="w-4 h-4" :class="{ 'animate-spin': isNotifying }" />
          {{ isNotifying ? t('admin.postEdit.notifying') : t('admin.postEdit.notifySubscribers') }}
        </button>
        <button
          type="submit"
          :disabled="isSubmitting"
          class="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-medium hover:from-blue-600 hover:to-indigo-600 shadow-lg shadow-blue-500/20 transition-all disabled:opacity-50"
        >
          <Icon :icon="isSubmitting ? 'lucide:loader-2' : 'lucide:save'" class="w-4 h-4" :class="{ 'animate-spin': isSubmitting }" />
          {{ isSubmitting ? t('admin.postEdit.saving') : t('admin.postEdit.save') }}
        </button>
        <button
          type="button"
          @click="handleCancel"
          class="inline-flex items-center gap-2 px-6 py-3 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-all"
        >
          <Icon icon="lucide:x" class="w-4 h-4" />
          {{ t("common.action.cancel") }}
        </button>
      </div>
    </form>
  </div>
</template>
