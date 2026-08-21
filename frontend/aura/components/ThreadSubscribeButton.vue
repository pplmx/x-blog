<script setup lang="ts">
/**
 * Comment-thread follow toggle (DEC-078, TASK-150).
 *
 * A signed-in reader clicks "订阅讨论" to follow a post's discussion and get a
 * Web Push every time a new comment is approved. Requires a reader account
 * (follows are not anonymous) — hidden entirely when nobody is signed in. If
 * the browser has no push subscription yet, the first follow click also opts
 * the device in (reader-bound, so the fan-out can target it); if push is
 * unsupported/blocked on this browser, following is disabled with a hint.
 */
import {
	fetchPostSubscription,
	subscribeToPostThread,
	unsubscribeFromPostThread,
} from "~~/composables/useApi";

interface Props {
	postId: number;
}

const props = defineProps<Props>();

const { t } = useLang();
const { isAuthenticated } = useReaderAuth();
const { status: pushStatus, init, subscribe } = usePushSubscription();

const following = ref(false);
const busy = ref(false);
const blocked = ref(false);
const error = ref(false);

onMounted(() => {
	void init();
	if (isAuthenticated.value) void loadFollowing();
});

async function loadFollowing() {
	try {
		const { data } = await fetchPostSubscription(props.postId);
		following.value = data.value?.subscribed === true;
	} catch {
		// Token/network hiccup: leave the button un-followed; an actual click
		// will surface a real error instead of silently lying about state.
		following.value = false;
	}
}

// Delivery capability: a "subscribed" browser reliably receives pushes; an
// "idle" one can still opt in (the click handler requests permission first).
// "unsupported"/"unconfigured"/"denied" means no delivery is possible, so the
// toggle is disabled with a hint (never a silent no-op follow).
const pushBlocked = computed(() =>
	["unsupported", "unconfigured", "denied"].includes(pushStatus.value),
);

const label = computed(() =>
	following.value
		? t("components.threadSubscribe.unfollow")
		: t("components.threadSubscribe.follow"),
);

async function toggle() {
	if (busy.value) return;
	busy.value = true;
	error.value = false;
	blocked.value = false;
	try {
		if (following.value) {
			await unsubscribeFromPostThread(props.postId);
			following.value = false;
			return;
		}
		// First follow: make sure this browser can actually receive pushes.
		if (pushStatus.value !== "subscribed") await subscribe();
		if (pushStatus.value !== "subscribed") {
			blocked.value = true; // permission denied / push unavailable
			return;
		}
		await subscribeToPostThread(props.postId);
		following.value = true;
	} catch {
		error.value = true;
	} finally {
		busy.value = false;
	}
}
</script>

<template>
  <button
    v-if="isAuthenticated"
    type="button"
    :disabled="busy || pushBlocked"
    :title="pushBlocked ? t('components.threadSubscribe.pushNeeded') : label"
    :aria-pressed="following ? 'true' : 'false'"
    :aria-label="label"
    class="inline-flex shrink-0 items-center gap-1.5 rounded-lg p-2 text-sm text-gray-500 dark:text-gray-400 transition-all duration-200 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
    @click="toggle"
  >
    <Icon :icon="following ? 'lucide:bell-ring' : 'lucide:bell'" :class="{ 'animate-spin': busy }" class="h-4 w-4" />
    {{ label }}
  </button>
  <p
    v-if="blocked && isAuthenticated"
    class="mt-1 text-xs text-amber-600 dark:text-amber-400"
  >
    {{ t("components.threadSubscribe.blockedHint") }}
  </p>
  <p v-else-if="error && isAuthenticated" class="mt-1 text-xs text-red-600 dark:text-red-400">
    {{ t("components.threadSubscribe.error") }}
  </p>
</template>
