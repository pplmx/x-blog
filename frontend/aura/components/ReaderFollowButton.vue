<script setup lang="ts">
/**
 * Inline reader-follow control on the public reader profile (round 365).
 *
 * The profile header shows every visitor how many readers follow this one
 * (follower_count, public like an author-follow count); a SIGNED-IN reader who
 * is not viewing their own profile gets a Follow/Following toggle here that
 * subscribes them to the target's approved-comment fan-out (the person-shaped
 * cousin of AuthorFollowButton — both answer "tell me when this person speaks
 * next"). Unlike AuthorFollowButton there is no initial follow-state GET: the
 * profile payload already carries the caller's own is_following, so the button
 * seeds from props. The count bumps optimistically off the server-confirmed
 * toggle result. Guests see the count only; self-profiles render neither
 * button nor a derp "follow yourself" control. Dead-session 401s drop the
 * expired token and offer the sign-in prompt (round-300 guard, mirrors
 * AuthorFollowButton).
 */
import { computed, ref, watch } from "vue";
import { followReader, unfollowReader } from "~~/api/reader/follows";
import { useFollowSessionGuard } from "~~/composables/useFollowSessionGuard";
import { useLang } from "~~/composables/useLang";
import { useReaderAuth } from "~~/composables/useReaderAuth";

defineOptions({ name: "ReaderFollowButton" });

const props = defineProps<{
	readerId: number;
	/** The caller's own stance from the profile payload (false for guests). */
	initialFollowing: boolean;
	/** Public follower count from the profile payload. */
	initialFollowerCount: number;
}>();

const { t } = useLang();
const { sessionExpired, guardFollowFailure } = useFollowSessionGuard();
const { isAuthenticated: signedIn, reader } = useReaderAuth();

// A reader viewing their OWN profile: the server rejects self-follow anyway,
// and a "Follow yourself" button is noise — hide it (the count still shows).
const isSelf = computed(() => signedIn.value && reader.value?.id === props.readerId);

const following = ref(props.initialFollowing);
const followerCount = ref(props.initialFollowerCount);
const followBusy = ref(false);

watch(
	() => [props.readerId, props.initialFollowing, props.initialFollowerCount] as const,
	([id, isFollowing, count]) => {
		// Reset to the profile's freshest state when the page targets another
		// reader or the profile reloads (SPA nav regression guard, mirrors
		// AuthorFollowButton's seq pattern: the watch owns resets).
		following.value = id === props.readerId ? isFollowing : false;
		followerCount.value = id === props.readerId ? count : 0;
		followBusy.value = false;
	},
);

const followerCountLabel = computed(() =>
	t(
		followerCount.value === 1
			? "readerProfile.followerCountOne"
			: "readerProfile.followerCountMany",
		{
			count: followerCount.value,
		},
	),
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
	try {
		if (following.value) {
			await unfollowReader(props.readerId);
			following.value = false;
			followerCount.value = Math.max(0, followerCount.value - 1);
		} else {
			await followReader(props.readerId);
			following.value = true;
			followerCount.value += 1;
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
	<span class="relative inline-flex items-center gap-3">
		<span
			v-if="followError"
			role="status"
			aria-live="polite"
			class="absolute top-full left-1/2 z-10 mt-1.5 -translate-x-1/2 whitespace-nowrap pointer-events-none rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/40 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400 shadow-sm"
		>
			{{ t('readerProfile.followFailed') }}
		</span>
		<!-- Follower count — public, every visitor sees it (like an author-follow
			 count). Rendered as a span even for guests, so the profile header is
			 not just a blank gap when signed out. -->
		<span
			class="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400"
			:aria-label="followerCountLabel"
		>
			<Icon icon="lucide:users" class="w-4 h-4" aria-hidden="true" />
			{{ followerCountLabel }}
		</span>
		<button
			v-if="signedIn && !isSelf"
			type="button"
			:disabled="followBusy"
			:title="t(following ? 'readerProfile.followingTitle' : 'readerProfile.followTitle')"
			:aria-pressed="following ? 'true' : 'false'"
			:aria-busy="followBusy"
			class="inline-flex items-center gap-1 text-sm font-medium transition-colors disabled:opacity-60"
			:class="following
				? 'text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300'
				: 'text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300'"
			@click="toggleFollow"
		>
			<Icon
				:icon="following ? 'lucide:user-check' : 'lucide:user-plus'"
				class="w-4 h-4"
			/>
			{{ t(following ? 'readerProfile.following' : 'readerProfile.follow') }}
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
