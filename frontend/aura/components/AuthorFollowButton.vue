<script setup lang="ts">
/**
 * Inline author-follow control (round 353).
 *
 * Attaches to the author byline on the post page so a signed-in reader can
 * follow/unfollow the writer in place — the same discoverability gap DEC-290
 * closed for series and DEC-196 for tags, but for the pen-named author behind
 * an article they just loved (author attribution, rounds 343-346/359). Renders
 * nothing for guests. Follow state is loaded through the imperative
 * getReaderAuthorFollows seam ($fetch — a lifecycle-hook useFetch never sends,
 * ISS-119/TASK-220) and the per-author notify toggle lives in /account's
 * followed-writers section; here it is a single follow/unfollow toggle.
 * Dead-session 401s drop the expired token and offer the sign-in prompt
 * instead of a misleading "follow failed" bubble (round-300 guard, mirrors
 * SeriesFollowButton).
 */
import { ref, watch } from "vue";
import {
	followReaderAuthor,
	getReaderAuthorFollows,
	unfollowReaderAuthor,
} from "~~/api/reader/follows";
import { useFollowSessionGuard } from "~~/composables/useFollowSessionGuard";
import { useLang } from "~~/composables/useLang";
import { useReaderAuth } from "~~/composables/useReaderAuth";

defineOptions({ name: "AuthorFollowButton" });

const props = defineProps<{
	authorId: number;
	authorName: string;
}>();

const { t } = useLang();
const { sessionExpired, guardFollowFailure } = useFollowSessionGuard();
const { isAuthenticated: signedIn } = useReaderAuth();

const followsAuthor = ref(false);
const followBusy = ref(false);
// Stale in-flight guard: SPA nav to a post by a DIFFERENT author must not let
// the previous author's follow-state GET overwrite the new byline's UI.
let followSeq = 0;

async function loadFollowState() {
	if (!signedIn.value) return;
	const seq = ++followSeq;
	try {
		const res = await getReaderAuthorFollows();
		if (seq !== followSeq) return; // stale — a newer author is in flight
		followsAuthor.value = (res.items ?? []).some((f) => f.author_id === props.authorId);
	} catch (cause) {
		if (seq !== followSeq) return;
		guardFollowFailure(cause);
	}
}

watch(
	[() => props.authorId, signedIn],
	() => {
		followsAuthor.value = false;
		if (signedIn.value) void loadFollowState();
	},
	{ immediate: true },
);

const followError = ref(false);
let followErrorTimer: ReturnType<typeof setTimeout> | undefined;
function noteFollowError() {
	if (followErrorTimer) clearTimeout(followErrorTimer);
	followError.value = true;
	followErrorTimer = setTimeout(() => {
		followError.value = false;
		followErrorTimer = undefined;
	}, 4000);
}

async function toggleFollow() {
	if (followBusy.value) return;
	followBusy.value = true;
	followSeq++; // a user action supersedes any in-flight follow-state loader
	try {
		if (followsAuthor.value) {
			await unfollowReaderAuthor(props.authorId);
			followsAuthor.value = false;
		} else {
			await followReaderAuthor(props.authorId);
			followsAuthor.value = true;
		}
	} catch (cause) {
		if (guardFollowFailure(cause)) return;
		// best-effort — keep current state on failure, but say so (deep-dive:
		// a silent no-op was indistinguishable from "in progress").
		noteFollowError();
	} finally {
		followBusy.value = false;
	}
}
onUnmounted(() => {
	if (followErrorTimer) clearTimeout(followErrorTimer);
});
</script>

<template>
	<span class="relative inline-flex">
		<span
			v-if="followError"
			role="status"
			aria-live="polite"
			class="absolute top-full left-1/2 z-10 mt-1.5 -translate-x-1/2 whitespace-nowrap pointer-events-none rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/40 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400 shadow-sm"
		>
			{{ t('post.followAuthorFailed') }}
		</span>
		<button
			v-if="signedIn"
			type="button"
			:disabled="followBusy"
			:title="t(followsAuthor ? 'post.followingAuthorTitle' : 'post.followAuthorTitle')"
			:aria-pressed="followsAuthor ? 'true' : 'false'"
			:aria-busy="followBusy"
			class="inline-flex items-center gap-1 text-sm font-medium transition-colors disabled:opacity-60"
			:class="followsAuthor
				? 'text-fuchsia-500 hover:text-fuchsia-700'
				: 'text-gray-400 hover:text-blue-500'"
			@click="toggleFollow"
		>
			<Icon
				:icon="followsAuthor ? 'lucide:user-check' : 'lucide:user-plus'"
				class="w-3.5 h-3.5"
			/>
			{{ t(followsAuthor ? 'post.followingAuthor' : 'post.followAuthor') }}
		</button>
		<span
			v-if="sessionExpired"
			class="inline-flex items-center gap-1.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
		>
			{{ t('common.sessionExpired') }}
			<NuxtLink to="/login" class="font-semibold underline underline-offset-2 hover:opacity-80">
				{{ t('reader.nav.signIn') }}
			</NuxtLink>
		</span>
	</span>
</template>
