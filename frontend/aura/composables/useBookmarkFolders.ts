/**
 * Cloud bookmark folders (DEC-120, TASK-172).
 *
 * Thin client wrapper over the reader bookmark-folder API: create/rename/
 * delete folders, load them with their saved-post counts, and file a
 * bookmarked post into (or out of) a folder. Server-backed only — folders are
 * a signed-in reader feature (guests keep the flat local bookmark list).
 */

import { ref } from "vue";
import {
	assignBookmarkFolder,
	type BookmarkFolder,
	createReaderBookmarkFolder,
	deleteReaderBookmarkFolder,
	fetchReaderBookmarkFolders,
	renameReaderBookmarkFolder,
} from "./useApi";

export function useBookmarkFolders() {
	const folders = ref<BookmarkFolder[]>([]);
	const loading = ref(false);

	async function load(): Promise<void> {
		loading.value = true;
		try {
			const res = await fetchReaderBookmarkFolders();
			folders.value = res.data?.value?.items ?? [];
		} catch {
			// Keep last-known list on transient failure.
		} finally {
			loading.value = false;
		}
	}

	async function create(name: string): Promise<boolean> {
		try {
			await createReaderBookmarkFolder(name);
			await load();
			return true;
		} catch {
			return false;
		}
	}

	async function rename(folderId: number, name: string): Promise<boolean> {
		try {
			await renameReaderBookmarkFolder(folderId, name);
			await load();
			return true;
		} catch {
			return false;
		}
	}

	async function remove(folderId: number): Promise<void> {
		try {
			await deleteReaderBookmarkFolder(folderId);
			await load();
		} catch {
			// best effort
		}
	}

	/** Assign a bookmarked post to a folder (folderId null clears it); reload counts. */
	async function assign(postId: number, folderId: number | null): Promise<void> {
		try {
			await assignBookmarkFolder(postId, folderId);
			await load();
		} catch {
			// best effort — local bookmark was already updated optimistically
		}
	}

	return { folders, loading, load, create, rename, remove, assign };
}
