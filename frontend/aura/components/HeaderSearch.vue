<script setup lang="ts">
import { ref } from "vue";
import type { PostList, PostListResponse } from "~~/api/contracts/shared";
import { command } from "~~/api/transport";

const { t } = useLang();

const query = ref("");
const open = ref(false);
const results = ref<PostList[]>([]);
const loading = ref(false);
const searched = ref(false);
// True when the last search attempt errored (rate limit / network / 5xx) — a
// real failure is NOT "no matches", and a rate-limited search-as-you-type must
// not read as an empty dead end (deep-dive finding).
const failed = ref(false);
const activeIndex = ref(-1);
let timer: ReturnType<typeof setTimeout> | null = null;
// Monotonic token so a slow, out-of-order response can't clobber a newer one:
// only the latest request's result is applied (TASK-096, ISS-077).
let requestSeq = 0;

async function runSearch(q: string): Promise<void> {
	if (!q.trim()) {
		results.value = [];
		searched.value = false;
		failed.value = false;
		return;
	}
	const seq = ++requestSeq;
	try {
		// Through the command seam (not a raw $fetch) so the transport's 429
		// detector raises the app-wide RateLimitNotice on throttling.
		const data = await command<PostListResponse>("/api/search", {
			query: { q: q.trim(), page: 1, limit: 5 },
		});
		// Ignore stale responses from an earlier keystroke.
		if (seq !== requestSeq) return;
		results.value = data.items;
		failed.value = false;
	} catch {
		if (seq !== requestSeq) return;
		results.value = [];
		failed.value = true;
	} finally {
		if (seq === requestSeq) {
			loading.value = false;
			searched.value = true;
		}
	}
}

// Debounced + minimum query so a search-as-you-type input stays within the
// backend's per-minute rate limit for /api/search.
function onInput(): void {
	if (timer) clearTimeout(timer);
	loading.value = true;
	open.value = true;
	activeIndex.value = -1;
	const q = query.value.trim();
	if (!q) {
		results.value = [];
		searched.value = false;
		loading.value = false;
		return;
	}
	timer = setTimeout(() => runSearch(q), 300);
}

function onKeydown(event: KeyboardEvent): void {
	if (event.key === "ArrowDown") {
		event.preventDefault();
		if (results.value.length) {
			activeIndex.value = (activeIndex.value + 1) % results.value.length;
		}
	} else if (event.key === "ArrowUp") {
		event.preventDefault();
		if (results.value.length) {
			activeIndex.value = (activeIndex.value - 1 + results.value.length) % results.value.length;
		}
	} else if (event.key === "Enter") {
		event.preventDefault();
		const post = results.value[activeIndex.value];
		if (activeIndex.value >= 0 && post) {
			pick(post);
		} else {
			goToSearch();
		}
	} else if (event.key === "Escape") {
		if (open.value) {
			// The dropdown actually consumed this Escape — signal it so parent
			// menu/window listeners (e.g. ISS-131's mobile-nav close handler)
			// don't ALSO treat it as "close the whole menu".
			event.preventDefault();
			close();
		}
	}
}

function pick(post: PostList): void {
	close();
	navigateTo(`/posts/${post.slug}`);
}

function goToSearch(): void {
	const q = query.value.trim();
	close();
	navigateTo(q ? { path: "/search", query: { q } } : "/search");
}

function close(): void {
	open.value = false;
	activeIndex.value = -1;
	requestSeq += 1; // invalidate any in-flight search
	if (timer) clearTimeout(timer);
}

// Delayed so a click inside the popup (mousedown.prevent) still lands before
// we unmount it on blur.
function onBlur(): void {
	setTimeout(close, 150);
}
</script>

<template>
  <div class="relative w-full">
    <div class="relative">
      <Icon
        icon="lucide:search"
        class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
      />
      <input
        v-model="query"
        type="search"
        role="combobox"
        :aria-expanded="open"
        aria-controls="header-search-listbox"
        aria-haspopup="listbox"
        :aria-activedescendant="activeIndex >= 0 ? `header-search-option-${activeIndex}` : undefined"
        :placeholder="t('headerSearch.placeholder')"
        :aria-label="t('headerSearch.ariaInput')"
        autocomplete="off"
        class="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
        @input="onInput"
        @keydown="onKeydown"
        @focus="open = true"
        @blur="onBlur"
      />
      <div v-if="loading" class="absolute right-3 top-1/2 -translate-y-1/2">
        <Icon icon="lucide:loader-2" class="w-4 h-4 text-gray-400 animate-spin" />
      </div>
    </div>

    <div
      v-if="open"
      class="absolute z-50 mt-2 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl overflow-hidden"
    >
      <ul id="header-search-listbox" role="listbox" class="max-h-80 overflow-auto py-1">
        <li
          v-for="(post, index) in results"
          :key="post.id"
          :id="`header-search-option-${index}`"
          role="option"
          :aria-selected="index === activeIndex"
          class="px-3 py-2 flex items-center gap-3 cursor-pointer transition-colors"
          :class="index === activeIndex
            ? 'bg-gray-50 dark:bg-gray-800'
            : 'hover:bg-gray-50 dark:hover:bg-gray-800'"
          @mousedown.prevent="pick(post)"
          @mouseenter="activeIndex = index"
        >
          <span class="flex-1 min-w-0">
            <span class="block text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-1">
              {{ post.title }}
            </span>
          </span>
          <span class="shrink-0 text-xs text-gray-400">{{ post.views }} · {{ post.category?.name ?? "" }}</span>
        </li>
      </ul>

      <div
        v-if="searched && !loading && failed"
        class="px-3 py-3 text-sm text-red-600 dark:text-red-400"
      >
        {{ t('headerSearch.searchFailed') }}
      </div>

      <div
        v-else-if="searched && !loading && results.length === 0"
        class="px-3 py-3 text-sm text-gray-500 dark:text-gray-400"
      >
        {{ t('headerSearch.noResults') }}
      </div>

      <!-- Live region: announces the settled result count to screen readers,
           and the zero-result state (the no-results div above is not live).
           A failed search announces the error too — never a false "no matches". -->
      <span class="sr-only" role="status" aria-live="polite">
        <template v-if="searched && !loading">
          <template v-if="failed">{{ t('headerSearch.searchFailed') }}</template>
          <template v-else>{{ results.length === 0 ? t('headerSearch.noResults') : t('headerSearch.resultsCount', { count: results.length }) }}</template>
        </template>
      </span>

      <button
        type="button"
        class="w-full px-3 py-2.5 text-left text-sm font-medium text-blue-600 dark:text-blue-400 border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        @mousedown.prevent
        @click="goToSearch"
      >
        {{ t('headerSearch.viewAll') }}
      </button>
    </div>
  </div>
</template>
