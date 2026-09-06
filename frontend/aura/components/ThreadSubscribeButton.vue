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
	getPostSubscription,
	subscribeToPostThread,
	unsubscribeFromPostThread,
} from "~~/api/reader/subscriptions";

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
		// Imperative read: usePostSubscription wraps useFetch, which silently
		// no-ops outside setup scope — from onMounted the button would never
		// learn it was already following and would mislabel itself "Follow".
		const status = await getPostSubscription(props.postId);
		following.value = status.subscribed === true;
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

// Persistent inline explanation for a pre-blocked browser (ISS-382): the
// disabled button's :title tooltip is unreliable on disabled controls and
// absent on touch, so a reader who once dismissed the permission prompt gets a
// visible "blocked in browser settings" line instead of a greyed mystery
// button. Distinguish the explicit-permission-denied case from generic
// non-delivery (VAPID unconfigured / API unsupported) so the copy is honest.
const deniedHint = computed(() =>
	pushStatus.value === "denied"
		? t("components.threadSubscribe.deniedHint")
		: t("components.threadSubscribe.pushNeeded"),
);

// Guest branch (ISS-382): the follow feature is reader-scoped, but instead of
// hiding it entirely point sign-in back at the current page so a guest
// discovers a discussion can be followed and returns here after signing in.
// Same-origin relative path only (no open redirect via an absolute URL).
const route = useRoute();
const signInTarget = computed(() => {
	const path = `${route.path}${route.query && Object.keys(route.query).length ? `?${new URLSearchParams(route.query as Record<string, string>).toString()}` : ""}`;
	return { path: "/login", query: { redirect: path } };
});

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
  <!-- Signed-in: the follow toggle. Guest branch below replaces the button so
       the feature is discoverable instead of silently absent. -->
  <button
    v-if="isAuthenticated"
    type="button"
    :disabled="busy || pushBlocked"
    :title="pushBlocked ? t('components.threadSubscribe.pushNeeded') : label"
    :aria-pressed="following ? 'true' : 'false'"
    :aria-label="label"
    :aria-busy="busy"
    class="inline-flex shrink-0 items-center gap-1.5 rounded-lg p-2 text-sm text-gray-500 dark:text-gray-400 transition-all duration-200 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
    @click="toggle"
  >
    <Icon :icon="following ? 'lucide:bell-ring' : 'lucide:bell'" :class="{ 'animate-spin': busy }" class="h-4 w-4" />
    {{ label }}
  </button>
  <!-- Pre-denied push state: the disabled button's :title tooltip is the ONLY
       explanation, and tooltips don't reliably appear on disabled buttons and
       never on touch — surface a persistent inline line instead (ISS-382). -->
  <p
    v-if="isAuthenticated && pushBlocked"
    role="status"
    class="mt-1 text-xs text-amber-600 dark:text-amber-400"
  >
    {{ deniedHint }}
  </p>
  <p
    v-else-if="blocked && isAuthenticated"
    role="status"
    class="mt-1 text-xs text-amber-600 dark:text-amber-400"
  >
    {{ t("components.threadSubscribe.blockedHint") }}
  </p>
  <p v-else-if="error && isAuthenticated" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">
    {{ t("components.threadSubscribe.error") }}
  </p>
  <!-- Guest: the feature needs an account (follows are not anonymous) — instead
       of hiding the affordance entirely, point sign-in at the current page so a
       guest discovers the discussion can be followed (ISS-382). -->
  <NuxtLink
    v-else
    :to="signInTarget"
    class="inline-flex shrink-0 items-center gap-1.5 rounded-lg p-2 text-sm text-gray-500 dark:text-gray-400 transition-all duration-200 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
  >
    <Icon icon="lucide:log-in" class="h-4 w-4" />
    {{ t("components.threadSubscribe.guestPrompt") }}
  </NuxtLink>
</template>
