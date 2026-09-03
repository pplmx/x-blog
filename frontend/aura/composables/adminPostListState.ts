/**
 * Admin posts-list navigation state (ISS-311 part 1).
 *
 * The editor (posts/[id].vue) returns to "/admin/posts" via a hardcoded URL
 * with no query, and the list page kept its search / status filter / page in
 * local setup refs — so an editor round-trip unmounted the list and lost it
 * all: Save/Cancel always landed on the unfiltered first page. These refs are
 * module-level singletons (same pattern as useBookmarks/useAdminAuth/
 * useReaderAuth) so a SPA round-trip through the editor re-mounts the list
 * with its search, status filter and page intact.
 */
import { ref } from "vue";

const searchQuery = ref("");
const searchInput = ref("");
const statusFilter = ref("");
const currentPage = ref(0);

/** Restore the default unfiltered state (used by tests between mounts). */
export function resetAdminPostListState(): void {
	searchQuery.value = "";
	searchInput.value = "";
	statusFilter.value = "";
	currentPage.value = 0;
}

export function useAdminPostListState() {
	return { searchQuery, searchInput, statusFilter, currentPage };
}
