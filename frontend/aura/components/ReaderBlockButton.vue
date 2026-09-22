<script setup lang="ts">
/**
 * Inline reader-block control on the public reader profile (round 379,
 * DEC-425).
 *
 * The harassment-control cousin of ReaderFollowButton: a SIGNED-IN reader
 * who is not viewing their own profile gets a compact Block/Unblock toggle
 * that opts them OUT of this reader's personal fan-out — @-mentions, replies,
 * thread-comments and follow-activity stop landing the moment the block is
 * placed, and nothing is sent to the blocked reader (blocking is one-way and
 * invisible; they can keep commenting). Blocking is a take-back-able safety
 * action, so the block direction confirms first and unblock is a one-click
 * restore. Guests see neither button; self-profiles never offer a "block
 * yourself" control. Dead-session 401s drop the expired token and offer the
 * sign-in prompt (round-300 guard, mirrors ReaderFollowButton).
 */
import { computed, ref, watch } from "vue";

import { blockReader, unblockReader } from "~~/api/reader/blocks";
import { useFollowSessionGuard } from "~~/composables/useFollowSessionGuard";
import { useLang } from "~~/composables/useLang";
import { useReaderAuth } from "~~/composables/useReaderAuth";

defineOptions({ name: "ReaderBlockButton" });

const props = defineProps<{
	readerId: number;
	/** The caller's own stance from the profile payload (false for guests). */
	initialBlocked: boolean;
}>();

const { t } = useLang();
const { sessionExpired, guardFollowFailure } = useFollowSessionGuard();
const { isAuthenticated: signedIn, reader } = useReaderAuth();

// A reader viewing their OWN profile: blocking yourself is rejected server-side
// and the control is noise — hide it (mirrors the self-follow rule).
const isSelf = computed(() => signedIn.value && reader.value?.id === props.readerId);

const blocked = ref(props.initialBlocked);
const blockBusy = ref(false);

watch(
	() => [props.readerId, props.initialBlocked] as const,
	([id, isBlocked]) => {
		// Reset to the profile's freshest state on SPA nav to another reader or
		// a profile reload (mirrors ReaderFollowButton's seq-owned resets).
		blocked.value = id === props.readerId ? isBlocked : false;
		blockBusy.value = false;
	},
);

const blockError = ref(false);
let blockErrorTimer: ReturnType<typeof setTimeout> | undefined;
function noteBlockError() {
	if (blockErrorTimer) clearTimeout(blockErrorTimer);
	blockError.value = true;
	blockErrorTimer = setTimeout(() => {
		blockError.value = false;
		blockErrorTimer = undefined;
	}, 4000);
}

async function applyBlock(nowBlocked: boolean) {
	if (blockBusy.value) return;
	blockBusy.value = true;
	try {
		if (nowBlocked) {
			await blockReader(props.readerId);
			blocked.value = true;
		} else {
			await unblockReader(props.readerId);
			blocked.value = false;
		}
	} catch (cause) {
		if (guardFollowFailure(cause)) return;
		// best-effort — keep current state on failure, but say so (the same
		// no-silent-noop rule as the follow button).
		noteBlockError();
	} finally {
		blockBusy.value = false;
	}
}

async function toggleBlock() {
	// Blocking is a safety action; confirm the irreversible-ish step one-click
	// to avoid accidental blocks. Unblock restores immediately, no confirm.
	if (!blocked.value && !window.confirm(t("readerProfile.blockConfirm"))) return;
	await applyBlock(!blocked.value);
}
onUnmounted(() => {
	if (blockErrorTimer) clearTimeout(blockErrorTimer);
});
</script>

<template>
	<span class="relative inline-flex items-center">
		<span
			v-if="blockError"
			role="status"
			aria-live="polite"
			class="absolute top-full left-1/2 z-10 mt-1.5 -translate-x-1/2 whitespace-nowrap pointer-events-none rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/40 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400 shadow-sm"
		>
			{{ t("readerProfile.blockFailed") }}
		</span>
		<button
			v-if="signedIn && !isSelf"
			type="button"
			:disabled="blockBusy"
			:aria-pressed="blocked ? 'true' : 'false'"
			:aria-busy="blockBusy"
			:title="t(blocked ? 'readerProfile.blockedTitle' : 'readerProfile.blockTitle')"
			class="inline-flex items-center gap-1 text-sm font-medium transition-colors disabled:opacity-60"
			:class="blocked
				? 'text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300'
				: 'text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400'"
			@click="toggleBlock"
		>
			<Icon :icon="blocked ? 'lucide:user-x' : 'lucide:user-minus'" class="w-4 h-4" />
			{{ t(blocked ? "readerProfile.blocked" : "readerProfile.blockAction") }}
		</button>
		<span
			v-if="sessionExpired"
			class="inline-flex items-center gap-1.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
		>
			{{ t("common.sessionExpired") }}
			<NuxtLink to="/login" class="font-semibold underline underline-offset-2 hover:opacity-80">
				{{ t("reader.nav.signIn") }}
			</NuxtLink>
		</span>
	</span>
</template>
