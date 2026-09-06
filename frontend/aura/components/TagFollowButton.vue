<script setup lang="ts">
/**
 * Inline tag-follow control (DEC-196/TASK-216).
 *
 * Attaches to a tag chip on the reading surface so a signed-in reader can
 * follow/unfollow the tag and toggle its new-post notifications in place,
 * instead of leaving the page for /tags. Renders nothing for guests, so the
 * surrounding chip looks unchanged for anonymous readers. Follow state comes
 * from the shared useTagFollowStore (one list fetch for every chip on a page).
 */
import { computed, onMounted, ref } from "vue";
import { useLang } from "~~/composables/useLang";
import { useTagFollowStore } from "~~/composables/useTagFollowStore";

defineOptions({ name: "TagFollowButton" });

const props = defineProps<{
	tagId: number;
	tagName: string;
}>();

const { t } = useLang();
const store = useTagFollowStore();

// Same synchronous localStorage gate the /tags page follow control uses; in
// SSR there is no browser storage, so the buttons never render server-side.
const signedIn = computed(() => {
	if (typeof window === "undefined") return false;
	return !!window.localStorage?.getItem("reader_token");
});

const following = store.following(props.tagId);
const notify = store.notify(props.tagId);
const busy = store.busy(props.tagId);

onMounted(() => {
	store.ensureLoaded().catch(() => {});
});

// A failed follow/notify used to be silently swallowed — the store clears its
// busy flag in a finally, so the button just did nothing. That is a silent
// no-op from the reader's perspective: the chip never toggles and nothing
// explains why. Surface a transient error (visible bubble + role=status live
// region, auto-clears) instead. The store state stays put on failure (same
// keep-last-state behavior), so the reader can simply retry.
const error = ref(false);
let errorTimer: ReturnType<typeof setTimeout> | undefined;
function flashError() {
	error.value = true;
	clearTimeout(errorTimer);
	errorTimer = setTimeout(() => {
		error.value = false;
	}, 2600);
}

async function handleToggleFollow() {
	if (busy.value) return;
	error.value = false;
	try {
		await store.toggleFollow(props.tagId);
	} catch {
		flashError();
	}
}

async function handleSetNotify() {
	if (busy.value) return;
	error.value = false;
	try {
		await store.setNotify(props.tagId, !notify.value);
	} catch {
		flashError();
	}
}
</script>

<template>
	<span
		v-if="signedIn"
		class="relative inline-flex items-center"
		:title="tagName"
		@click.stop.prevent
	>
		<!-- Transient failure bubble: visible and announced via role=status when a
		     follow/notify call rejects. Anchored absolutely so it never shifts the
		     tag row. Anchored BELOW the chip (top-full): the tags row is a wrapping
		     flex, so an above-anchored bubble (bottom-full) painted over the chip in
		     the row above (ISS-230); dropping it downward lands it in the whitespace
		     below the footer for the common single-row / last-row cases. -->
		<span
			v-if="error"
			role="status"
			aria-live="polite"
			class="absolute top-full left-1/2 z-10 mt-1.5 -translate-x-1/2 whitespace-nowrap pointer-events-none rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/40 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400 shadow-sm"
		>
			{{ t('tags.followFailed') }}
		</span>
		<!-- Hit-target + in-flight feedback (deep-dive ISS-380): p-1 padding made
		     ~22px touch targets well under the 44px guideline, and while busy the
		     only feedback was disabled:opacity-40 — a follow tap on a slow network
		     looked like a silent no-op. p-2 grows the target; the icon swaps to a
		     spinner while busy (matching SubscribeButton / the post like button). -->
		<button
			type="button"
			:disabled="busy"
			:title="`${tagName} ${t(following ? 'tags.followingTitle' : 'tags.followTitle')}`"
			:aria-label="`${tagName} ${t(following ? 'tags.followingTitle' : 'tags.followTitle')}`"
			:aria-pressed="following ? 'true' : 'false'"
			:aria-busy="busy"
			class="inline-flex items-center p-2 rounded-full transition-colors disabled:opacity-40"
			:class="error
				? 'text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300'
				: 'text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400'"
			@click="handleToggleFollow"
		>
			<Icon
				:icon="busy ? 'lucide:loader-2' : (following ? 'lucide:bookmark-check' : 'lucide:bookmark')"
				class="w-3.5 h-3.5"
				:class="{ 'animate-spin': busy }"
			/>
		</button>
		<button
			v-if="following"
			type="button"
			:disabled="busy"
			:title="`${tagName} ${t('tags.notifyTitle')}`"
			:aria-label="`${tagName} ${t(notify ? 'tags.notifyOn' : 'tags.notifyOff')}`"
			:aria-pressed="notify ? 'true' : 'false'"
			:aria-busy="busy"
			class="inline-flex items-center p-2 rounded-full transition-colors disabled:opacity-40"
			:class="error
				? 'text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300'
				: 'text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400'"
			@click="handleSetNotify"
		>
			<Icon
				:icon="busy ? 'lucide:loader-2' : (notify ? 'lucide:bell' : 'lucide:bell-off')"
				class="w-3.5 h-3.5"
				:class="{ 'animate-spin': busy }"
			/>
		</button>
	</span>
</template>
