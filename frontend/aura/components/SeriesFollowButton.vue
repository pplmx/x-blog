<script setup lang="ts">
/**
 * Inline series-follow control (DEC-290 / TASK-374).
 *
 * Attaches to the in-series nav box on the post page so a signed-in reader can
 * follow/unfollow the current series and toggle its new-part notifications in
 * place — the same discoverability gap DEC-196 closed for tags, but for series
 * (which only had a follow surface on /series/[slug]). Renders nothing for
 * guests. Follow state is loaded through the imperative getReaderSeriesFollows
 * seam ($fetch — a lifecycle-hook useFetch never sends, ISS-119/TASK-220).
 * Dead-session 401s drop the expired token and offer the sign-in prompt
 * instead of a misleading "failed" bubble (round-300 guard, mirrors the
 * /series page follow block).
 */
import { ref, watch } from "vue";
import {
	followReaderSeries,
	getReaderSeriesFollows,
	setSeriesFollowNotify,
	unfollowReaderSeries,
} from "~~/api/reader/follows";
import { useFollowSessionGuard } from "~~/composables/useFollowSessionGuard";
import { useLang } from "~~/composables/useLang";
import { useReaderAuth } from "~~/composables/useReaderAuth";

defineOptions({ name: "SeriesFollowButton" });

const props = defineProps<{
	seriesId: number;
	seriesTitle: string;
}>();

const { t } = useLang();
// Dead-session guard (same reasoning as TagFollowButton / the series page):
// the follow APIs are reader-auth-scoped, so an expired stored token used to
// make every tap on this post-page control 401 into a generic "follow failed"
// bubble with no path back to sign-in. On a stale-session 401 the guard drops
// the dead token and the sign-in prompt renders instead.
const { sessionExpired, guardFollowFailure } = useFollowSessionGuard();

// Reactive reader-auth singleton (NOT an ad-hoc localStorage read): after
// guardFollowFailure() drops the dead token, isAuthenticated flips to false
// and the control unmounts. SSR sees false (no browser storage), so the
// control never renders server-side.
const { isAuthenticated: signedIn } = useReaderAuth();

const followsSeries = ref(false);
const followNotify = ref(true);
const followBusy = ref(false);
// Stale in-flight guard: SPA nav to a post in a DIFFERENT series must not let
// the previous series' follow-state GET overwrite the new series' UI. A
// counter stamp invalidates any request that was in flight when the series
// changed (mirrors the /series page followSeq).
let followSeq = 0;

async function loadFollowState() {
	if (!signedIn.value) return;
	const seq = ++followSeq;
	try {
		const res = await getReaderSeriesFollows();
		if (seq !== followSeq) return; // stale — a newer series is in flight
		const item = res.items.find((f) => f.id === props.seriesId) ?? null;
		followsSeries.value = !!item;
		followNotify.value = item?.notify ?? true;
	} catch (cause) {
		if (seq !== followSeq) return;
		// A dead session is not a transient outage: drop the token so the
		// control flips to signed-out and the sign-in prompt shows — instead of
		// silently looking like the reader never followed (survey finding).
		guardFollowFailure(cause);
	}
}

// (Re)load whenever the series or sign-in state changes. Lives after followSeq
// so the immediate callback never touches a TDZ binding.
watch(
	[() => props.seriesId, signedIn],
	() => {
		followsSeries.value = false;
		followNotify.value = true;
		if (signedIn.value) {
			void loadFollowState();
		}
	},
	{ immediate: true },
);

// Follow/notify failures surface here (deep-dive finding): an offline/429/500
// tap must never be a silent no-op.
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
		if (followsSeries.value) {
			await unfollowReaderSeries(props.seriesId);
			followsSeries.value = false;
		} else {
			const res = await followReaderSeries(props.seriesId);
			followsSeries.value = true;
			followNotify.value = res?.notify ?? true;
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

/** Toggle new-part push on/off for a followed series (TASK-181). */
async function toggleNotify() {
	if (followBusy.value || !followsSeries.value) return;
	followBusy.value = true;
	followSeq++;
	const next = !followNotify.value;
	try {
		const res = await setSeriesFollowNotify(props.seriesId, next);
		followNotify.value = res?.notify ?? next;
	} catch (cause) {
		if (guardFollowFailure(cause)) return;
		// best-effort — keep current state on failure, but say so (deep-dive).
		noteFollowError();
	} finally {
		followBusy.value = false;
	}
}
</script>

<template>
	<!-- Dead-session prompt sits OUTSIDE the signedIn gate: guardFollowFailure
	     drops the dead token, which flips signedIn off and unmounts the
	     control — the prompt must survive that to offer the way back in. -->
	<span
		v-if="sessionExpired"
		role="alert"
		class="inline-flex items-center gap-1.5 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/40 px-2 py-1 text-[10px] font-medium text-amber-700 dark:text-amber-300"
	>
		<Icon
			icon="lucide:triangle-alert"
			class="h-3 w-3 shrink-0"
			aria-hidden="true"
			role="presentation"
		/>
		{{ t('common.sessionExpired') }}
		<NuxtLink
			to="/login"
			class="font-semibold underline underline-offset-2 hover:opacity-80"
		>
			{{ t('reader.nav.signIn') }}
		</NuxtLink>
	</span>
	<span
		v-if="signedIn"
		class="relative inline-flex items-center gap-2"
	>
		<!-- Transient failure bubble: visible and announced via role=status when a
		     follow/notify call rejects. Anchored absolutely so it never shifts the
		     series nav row; dropped BELOW the control into the whitespace. -->
		<span
			v-if="followError"
			role="status"
			aria-live="polite"
			class="absolute top-full left-1/2 z-10 mt-1.5 -translate-x-1/2 whitespace-nowrap pointer-events-none rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/40 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400 shadow-sm"
		>
			{{ t('series.followFailed') }}
		</span>
		<button
			type="button"
			:disabled="followBusy"
			:title="`${seriesTitle} ${t(followsSeries ? 'series.followingNewPartsTitle' : 'series.followNewPartsTitle')}`"
			:aria-pressed="followsSeries ? 'true' : 'false'"
			:aria-busy="followBusy"
			class="inline-flex items-center gap-1 text-sm font-medium text-fuchsia-500 hover:text-fuchsia-700 transition-colors disabled:opacity-60"
			@click="toggleFollow"
		>
			<Icon
				:icon="followBusy ? 'lucide:loader-2' : (followsSeries ? 'lucide:bell-ring' : 'lucide:bell')"
				class="w-4 h-4"
				:class="{ 'animate-spin': followBusy }"
			/>
			{{ t(followsSeries ? 'series.followingNewParts' : 'series.followNewParts') }}
		</button>
		<button
			v-if="followsSeries"
			type="button"
			:disabled="followBusy"
			:title="`${seriesTitle} ${t('series.notifyTitle')}`"
			:aria-pressed="followNotify ? 'true' : 'false'"
			:aria-busy="followBusy"
			class="inline-flex items-center gap-1 text-sm font-medium text-indigo-500 hover:text-indigo-700 transition-colors disabled:opacity-60"
			@click="toggleNotify"
		>
			<Icon
				:icon="followBusy ? 'lucide:loader-2' : (followNotify ? 'lucide:bell' : 'lucide:bell-off')"
				class="w-4 h-4"
				:class="{ 'animate-spin': followBusy }"
			/>
			{{ t(followNotify ? 'series.notifyOn' : 'series.notifyOff') }}
		</button>
	</span>
</template>
