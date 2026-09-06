<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
// biome-ignore lint/correctness/noUnusedImports: used from the template — biome cannot resolve Vue script-setup template bindings (vue-tsc verifies).
import { parseApiDate } from "~~/composables/apiDate";
import { useBookmarkFolders } from "~~/composables/useBookmarkFolders";
import { useBookmarkSync } from "~~/composables/useBookmarkSync";
import { type Bookmark, useBookmarks } from "~~/composables/useBookmarks";
import { useReaderAuth } from "~~/composables/useReaderAuth";
import { useSeo } from "~~/composables/useSeo";

const { t, locale } = useLang();
const { bookmarks, bookmarkCount } = useBookmarks();
const { add, remove, clearAll, mergeLocalToCloud, syncing, syncIssue, clearSyncIssue } =
	useBookmarkSync();
const {
	folders,
	load: loadFolders,
	create: createFolder,
	rename: renameFolder,
	remove: removeFolder,
	assign: assignFolder,
} = useBookmarkFolders();

useSeo(() => ({
	title: t("bookmarks.seoTitle"),
	description: t("bookmarks.seoDesc"),
	path: "/bookmarks",
}));

// Folders are a signed-in (cloud) feature. Uses the reactive reader-auth
// singleton (not an ad-hoc localStorage read) so the folder UI and nav react
// to sign-out while the page is mounted — a plain `localStorage.getItem` in a
// computed never invalidates, leaving the bar and filter stale after logout
// (deep-dive finding).
const { isAuthenticated: signedIn } = useReaderAuth();

// Clear-all cloud failure (ISS-387): offline (or a dead session) leaves the
// server copy alive, and the next merge pulls those rows straight back — so a
// permanent-looking "cleared" state would be a lie. Flag it instead.
const clearFailed = ref(false);

async function handleClearAll() {
	if (confirm(t("bookmarks.confirmClear"))) {
		// clearAll wipes the localStorage mirror AND the cloud copy when signed
		// in, so the clear actually sticks (TASK-233). The old clearBookmarks
		// only cleared local storage and the next cloud merge resurrected rows.
		clearFailed.value = false;
		const ok = await clearAll();
		if (!ok) clearFailed.value = true;
	}
}

// One-click row removal mirrors straight to the cloud — a mis-click must not be
// unrecoverable, so keep the removed bookmark and offer a short Undo inline
// (differs from Clear-all / folder-delete, which confirm up front).
const undoItem = ref<Bookmark | null>(null);
let undoClearTimer: ReturnType<typeof setTimeout> | undefined;
function handleRemove(bookmark: Bookmark) {
	remove(bookmark.id);
	undoItem.value = bookmark;
	if (undoClearTimer) clearTimeout(undoClearTimer);
	undoClearTimer = setTimeout(() => {
		undoItem.value = null;
	}, 6000);
}
async function undoRemove() {
	if (!undoItem.value) return;
	const { ...restored } = undoItem.value;
	add(restored);
	// The undo re-PUTs the bookmark to the cloud (via add -> mirrorAdd), but
	// that PUT carries only the post id — a removed bookmark that lived in a
	// folder would come back UN-filed on the next cloud merge when the pull
	// re-adopts the server row. Re-apply the folder assignment explicitly so
	// the restored row keeps its folder across devices (deep-dive, ISS-388).
	if (undoItem.value.folder_id != null && signedIn.value) {
		await assignFolder(undoItem.value.id, undoItem.value.folder_id);
	}
	if (undoClearTimer) clearTimeout(undoClearTimer);
	undoClearTimer = undefined;
	undoItem.value = null;
}

// Clear both timers so a delayed ref-set can't fire after unmount (same
// hygiene as the history page's debounce cleanup).
onUnmounted(() => {
	if (undoClearTimer) clearTimeout(undoClearTimer);
	if (folderActionTimer) clearTimeout(folderActionTimer);
});

// When a signed-in reader opens the page, reconcile with the cloud: push any
// local-only bookmarks up and adopt the merged server list (other-device
// changes appear here). Safe while logged out — no-op. (TASK-134)
onMounted(() => {
	void mergeLocalToCloud();
	if (signedIn.value) {
		void loadFolders();
	}
});

// --- Folders (DEC-120, TASK-172) ------------------------------------------

const activeFolderId = ref<"all" | number>("all");
const showManage = ref(false);
// Folder create/rename/reassign failures surface here (deep-dive finding).
const folderActionFailed = ref(false);
let folderActionTimer: ReturnType<typeof setTimeout> | undefined;

// Keyword search (DEC-124, TASK-174): matches title, category, or tag names,
// case-insensitive, and composes with the active folder filter.
const searchQuery = ref("");
const searchText = computed(() => searchQuery.value.trim().toLowerCase());
const searching = computed(() => searchText.value !== "");

const filteredBookmarks = computed<Bookmark[]>(() => {
	if (activeFolderId.value === "all") return bookmarks.value;
	return bookmarks.value.filter((b) => b.folder_id === activeFolderId.value);
});

const searchedBookmarks = computed<Bookmark[]>(() => {
	if (!searching.value) return filteredBookmarks.value;
	const q = searchText.value;
	return filteredBookmarks.value.filter((b) => {
		if ((b.title || "").toLowerCase().includes(q)) return true;
		if (b.category?.name?.toLowerCase().includes(q)) return true;
		return b.tags.some((t) => t.name.toLowerCase().includes(q));
	});
});

// Matches the rendered list in every case (folder filter, search, or neither).
const showingCount = computed(() => searchedBookmarks.value.length);

function noteFolderActionFailure() {
	folderActionFailed.value = true;
	if (folderActionTimer) clearTimeout(folderActionTimer);
	folderActionTimer = setTimeout(() => {
		folderActionFailed.value = false;
	}, 4000);
}

async function handleNewFolder() {
	const name = window.prompt(t("bookmarks.newFolderPrompt"))?.trim();
	if (name && !(await createFolder(name))) {
		// create returns false on failure — surface it instead of silently
		// ignoring the reader's input (deep-dive finding).
		noteFolderActionFailure();
	}
}

async function handleRename(folder: { id: number; name: string }) {
	const name = window.prompt(t("bookmarks.renameFolderPrompt"), folder.name)?.trim();
	if (name && name !== folder.name && (await renameFolder(folder.id, name))) {
		// The folder list refreshed, but the local bookmark rows still carry the
		// old folder_name — sync them so chips and the manage panel agree
		// (deep-dive finding: rename left rows showing the previous name).
		for (const b of bookmarks.value) {
			if (b.folder_id === folder.id) b.folder_name = name;
		}
	} else if (name && name !== folder.name) {
		noteFolderActionFailure();
	}
}

async function handleDelete(folder: { id: number; name: string }) {
	if (!confirm(t("bookmarks.deleteFolderConfirm", { name: folder.name }))) return;
	const ok = await removeFolder(folder.id);
	if (!ok) {
		// Offline failed delete: keep the folder, keep the filter, and say so —
		// the old path reset the filter optimistically and swallowed the error.
		noteFolderActionFailure();
		return;
	}
	// The folder is gone from the list, and any bookmarks filed in it are
	// implicitly unfiled: reconcile the local rows so no bookmarked post still
	// shows a deleted folder's chip or binds a select option that no longer
	// exists (deep-dive finding).
	for (const b of bookmarks.value) {
		if (b.folder_id === folder.id) {
			b.folder_id = null;
			b.folder_name = null;
		}
	}
	// Drop the filter only once the delete actually succeeded — an active filter
	// on the deleted folder is an invisible list otherwise.
	if (activeFolderId.value === folder.id) activeFolderId.value = "all";
}

function activeClass(active: boolean): string {
	return active
		? "px-3 py-1.5 rounded-xl text-sm font-medium bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300"
		: "px-3 py-1.5 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors";
}

const assignFailed = ref(false);
// The rows whose folder select has an assignment in flight. Each row is tracked
// INDEPENDENTLY in a Set so two different rows can be in flight at once without
// clearing each other's guard — a single slot let the second row's finally wipe
// the first row's in-flight marker, re-enabling its select mid-PATCH (deep-dive
// finding). Disables THAT row's select only, so two rapid changes can't fire
// overlapping PATCHes that clobber each other's optimistic state and rollback.
const assigningIds = ref(new Set<number>());

// On sign-out the folder bar (signed-in only, v-if=signedIn) disappears but
// the local bookmark rows keep their folder_id — without resetting the active
// folder the list stayed stuck filtered to a folder whose bar (including the
// "All" chip that would clear it) is gone: an invisible, un-clearable filter
// (deep-dive finding).
watch(signedIn, (authed) => {
	if (authed) return;
	activeFolderId.value = "all";
	searchQuery.value = "";
	showManage.value = false;
	assignFailed.value = false;
	clearFailed.value = false;
	assigningIds.value.clear();
});

async function handleAssign(bookmark: Bookmark, raw: string) {
	if (assigningIds.value.has(bookmark.id)) return; // single-flight per row
	const folderId = raw === "" ? null : Number(raw);
	const prevId = bookmark.folder_id;
	const prevName = bookmark.folder_name;
	assigningIds.value.add(bookmark.id);
	// Optimistic local update so the list re-renders immediately.
	bookmark.folder_id = folderId;
	bookmark.folder_name =
		folderId === null ? null : (folders.value.find((f) => f.id === folderId)?.name ?? null);
	try {
		const ok = await assignFolder(bookmark.id, folderId);
		// Roll the row back when the server rejected the change, so the UI never
		// claims a folder assignment the cloud did not persist (deep-dive finding).
		// Only roll back if this call's optimistic value is still on the row —
		// a newer assign or the mount merge could have moved it on.
		if (!ok) {
			if (bookmark.folder_id === folderId) {
				bookmark.folder_id = prevId;
				bookmark.folder_name = prevName;
			}
			assignFailed.value = true;
			setTimeout(() => {
				assignFailed.value = false;
			}, 4000);
		}
	} finally {
		assigningIds.value.delete(bookmark.id);
	}
}
</script>

<template>
  <div class="max-w-5xl mx-auto px-4 py-12">
    <!-- Header -->
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1
          class="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent"
        >
          {{ t('bookmarks.title') }}
        </h1>
        <p v-if="bookmarkCount > 0" class="text-sm text-gray-500 dark:text-gray-400 mt-2">
          {{ t('bookmarks.countLabel', { count: showingCount }) }}
        </p>
      </div>
      <button
        v-if="bookmarkCount > 0"
        type="button"
        @click="handleClearAll"
        class="text-sm text-gray-500 hover:text-red-500 transition-colors"
        :title="t('bookmarks.clearAll')"
      >
        <Icon icon="lucide:trash-2" class="w-4 h-4 inline mr-1" />
        {{ t('bookmarks.clearAll') }}
      </button>
    </div>

    <!-- Folder-assign failure (deep-dive finding): the optimistic local change
         was rolled back — tell the reader so the UI feedback is never silent. -->
    <p
      v-if="assignFailed"
      class="mb-4 text-sm text-red-600 dark:text-red-400"
      role="alert"
    >
      {{ t('bookmarks.assignFailed') }}
    </p>

    <!-- Folder create/rename failure (deep-dive finding): the prompt closed and
         the list did not change — surface why instead of a silent no-op. -->
    <p
      v-if="folderActionFailed"
      class="mb-4 text-sm text-red-600 dark:text-red-400"
      role="alert"
    >
      {{ t('bookmarks.folderFailed') }}
    </p>

    <!-- Clear-all cloud failure (ISS-387): the local mirror is empty but the
         server copy survived (offline/dead session) and will return on the next
         merge — never present that as a done deal. -->
    <p
      v-if="clearFailed"
      class="mb-4 text-sm text-red-600 dark:text-red-400"
      role="alert"
    >
      {{ t('bookmarks.clearOffline') }}
    </p>

    <!-- Dead-session sync warning (ISS-222): the stored token is no longer
         accepted, so bookmarks are saved locally but silently dropped by the
         cloud. The reader must know — otherwise the next merge re-imports the
         server list and their "saved" bookmark vanishes without a trace. -->
    <div
      v-if="syncIssue === 'auth'"
      class="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-800 dark:text-amber-200"
      role="alert"
    >
      <span class="min-w-0">
        {{ t('bookmarks.sessionExpired') }}
        <NuxtLink
          to="/login"
          class="shrink-0 font-medium text-amber-800 dark:text-amber-200 underline underline-offset-2 hover:opacity-80"
        >
          {{ t('bookmarks.login') }}
        </NuxtLink>
      </span>
      <button
        type="button"
        :aria-label="t('bookmarks.dismiss')"
        class="shrink-0 p-1 rounded-lg text-amber-600 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
        @click="clearSyncIssue"
      >
        <Icon icon="lucide:x" class="w-4 h-4" />
      </button>
    </div>

    <!-- Removal undo (single bookmark remove is one-click + clouds immediately) -->
    <div
      v-if="undoItem"
      class="mb-4 flex items-center justify-between gap-3 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 px-4 py-3 text-sm text-blue-700 dark:text-blue-300"
      role="status"
    >
      <span class="min-w-0 truncate">{{ t('bookmarks.removedToast', { title: undoItem.title }) }}</span>
      <button
        type="button"
        class="shrink-0 font-medium text-blue-700 dark:text-blue-300 hover:underline"
        @click="undoRemove"
      >
        {{ t('bookmarks.undo') }}
      </button>
    </div>

    <!-- Bookmark search (DEC-124, TASK-174) -->
    <div v-if="bookmarkCount > 0" class="mb-6">
      <div class="relative max-w-md">
        <Icon icon="lucide:search" class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          v-model="searchQuery"
          type="search"
          :placeholder="t('bookmarks.searchPlaceholder')"
          :aria-label="t('bookmarks.searchPlaceholder')"
          class="w-full pl-9 pr-9 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent text-sm text-gray-700 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        />
        <button
          v-if="searchQuery"
          type="button"
          :aria-label="t('bookmarks.clearSearch')"
          class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          @click="searchQuery = ''"
        >
          <Icon icon="lucide:x" class="w-4 h-4" />
        </button>
      </div>
    </div>

    <!-- Folder bar (signed-in only) -->
    <div v-if="signedIn" class="mb-6">
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" :class="activeClass(activeFolderId === 'all')" @click="activeFolderId = 'all'">
          {{ t('bookmarks.allFolders') }}
        </button>
        <button
          v-for="f in folders"
          :key="f.id"
          type="button"
          :class="activeClass(activeFolderId === f.id)"
          @click="activeFolderId = f.id"
        >
          {{ f.name }} ({{ f.count }})
        </button>
        <span class="mx-1 w-px h-5 bg-gray-200 dark:bg-gray-700" />
        <button
          type="button"
          class="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-sm font-medium text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/30 transition-colors"
          @click="handleNewFolder"
        >
          <Icon icon="lucide:folder-plus" class="w-4 h-4" />
          {{ t('bookmarks.newFolder') }}
        </button>
        <button
          v-if="folders.length"
          type="button"
          :aria-expanded="showManage"
          class="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          @click="showManage = !showManage"
        >
          <Icon :icon="showManage ? 'lucide:x' : 'lucide:settings-2'" class="w-4 h-4" />
          {{ t(showManage ? 'bookmarks.closeManage' : 'bookmarks.manageFolders') }}
        </button>
      </div>

      <!-- Manage-folder panel -->
      <div v-if="showManage" class="mt-4 p-4 rounded-2xl border border-gray-100 dark:border-gray-800">
        <ul class="space-y-2">
          <li v-for="f in folders" :key="f.id" class="flex items-center justify-between gap-4">
            <span class="text-sm text-gray-700 dark:text-gray-200">{{ f.name }}</span>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="text-xs text-gray-500 hover:text-blue-600 transition-colors"
                @click="handleRename(f)"
              >
                {{ t('bookmarks.renameFolder') }}
              </button>
              <button
                type="button"
                class="text-xs text-gray-500 hover:text-red-500 transition-colors"
                @click="handleDelete(f)"
              >
                {{ t('bookmarks.deleteFolder') }}
              </button>
            </div>
          </li>
        </ul>
      </div>
    </div>

    <!-- Cloud reconciliation (signed-in, fresh device): the local list is empty
         until the cloud pull lands, so show a light in-flight hint instead of
         a false "you have no bookmarks yet" empty state (deep-dive finding). -->
    <div
      v-if="bookmarkCount === 0 && syncing"
      class="text-center py-16 text-gray-500 dark:text-gray-400"
      role="status"
    >
      <Icon icon="lucide:loader-2" class="w-10 h-10 mx-auto mb-4 animate-spin text-gray-300" />
      <p class="text-lg">{{ t('bookmarks.syncing') }}</p>
    </div>

    <!-- Empty state (only once sync finished and nothing remains) -->
    <div
      v-else-if="bookmarkCount === 0 && !syncing"
      class="text-center py-16 text-gray-500 dark:text-gray-400"
    >
      <Icon icon="lucide:bookmark" class="w-12 h-12 mx-auto mb-4 text-gray-300" />
      <p class="text-lg mb-4">{{ t('bookmarks.empty') }}</p>
      <NuxtLink
        to="/"
        class="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors"
      >
        <Icon icon="lucide:arrow-left" class="w-4 h-4" />
        {{ t('bookmarks.browse') }}
      </NuxtLink>
    </div>

    <!-- No results in the current folder/search -->
    <div
      v-else-if="searchedBookmarks.length === 0"
      class="text-center py-16 text-gray-500 dark:text-gray-400"
    >
      <Icon :icon="searching ? 'lucide:search-x' : 'lucide:folder-open'" class="w-12 h-12 mx-auto mb-4 text-gray-300" />
      <p class="text-lg">{{ searching ? t('bookmarks.noSearchResults') : t('bookmarks.noPostsInFolder') }}</p>
    </div>

    <!-- Bookmarks list -->
    <div v-else class="space-y-4">
      <div
        v-for="bookmark in searchedBookmarks"
        :key="bookmark.id"
        class="border border-gray-100 dark:border-gray-800 rounded-2xl p-4 hover:shadow-md transition-shadow"
      >
        <div class="flex items-start gap-4">
          <!-- Bookmark data -->
          <div class="flex-1">
            <NuxtLink
              :to="`/posts/${bookmark.slug}`"
              class="text-xl font-bold text-gray-900 dark:text-gray-100 hover:text-blue-600 transition-colors line-clamp-2"
            >
              {{ bookmark.title }}
            </NuxtLink>

            <p
              v-if="bookmark.excerpt"
              class="text-gray-600 dark:text-gray-300 mt-2 text-sm line-clamp-2"
            >
              {{ bookmark.excerpt }}
            </p>

            <div class="flex items-center gap-4 mt-3 text-sm text-gray-500 dark:text-gray-400">
              <span v-if="bookmark.category" class="flex items-center gap-1">
                <Icon icon="lucide:folder" class="w-4 h-4" />
                {{ bookmark.category.name }}
              </span>
              <span v-if="bookmark.folder_name" class="flex items-center gap-1 text-violet-500">
                <Icon icon="lucide:layers" class="w-4 h-4" />
                {{ bookmark.folder_name }}
              </span>
              <span class="flex items-center gap-1">
                <Icon icon="lucide:calendar" class="w-4 h-4" />
                {{ parseApiDate(bookmark.created_at)?.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", { year: 'numeric', month: 'long', day: 'numeric' }) ?? "" }}
              </span>
            </div>

            <div class="mt-2 flex flex-wrap gap-2">
              <span
                v-for="tag in bookmark.tags"
                :key="tag.id"
                class="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full"
              >
                #{{ tag.name }}
              </span>
            </div>

            <!-- Folder assignment (signed-in only) -->
            <div v-if="signedIn" class="mt-3">
              <label class="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <Icon icon="lucide:folder" class="w-4 h-4" />
                <span>{{ t('bookmarks.assign') }}</span>
                <select
                  :value="bookmark.folder_id ?? ''"
                  :disabled="assigningIds.has(bookmark.id)"
                  :aria-busy="assigningIds.has(bookmark.id)"
                  class="ml-1 text-sm bg-transparent border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 text-gray-700 dark:text-gray-200 focus:outline-none disabled:opacity-50"
                  @change="handleAssign(bookmark, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="">{{ t('bookmarks.noFolder') }}</option>
                  <option v-for="f in folders" :key="f.id" :value="f.id">{{ f.name }}</option>
                </select>
              </label>
            </div>
          </div>

          <!-- Remove button (aria-label, not just a title tooltip, ISS-137) -->
          <button
            type="button"
            @click.stop="handleRemove(bookmark)"
            :title="t('bookmarks.remove')"
            :aria-label="t('bookmarks.remove')"
            class="shrink-0 p-2 text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
          >
            <Icon icon="lucide:x" class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
