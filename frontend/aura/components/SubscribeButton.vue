<script setup lang="ts">
/**
 * Header button that drives the reader Web Push opt-in (DEC-055, TASK-118).
 *
 * Hidden until we know the browser and backend can support push
 * (PushManager + a configured VAPID public key). From there it toggles
 * subscribe/unsubscribe and reflects the Permission API's blocked state.
 *
 * Reader-aware since DEC-064: a subscription taken while signed in is bound to
 * the reader account, so its tooltip advertises comment-reply notifications;
 * signing in re-stamps an existing (previously anonymous) subscription so
 * reply notifications turn on without requiring a re-subscribe.
 */
const { t } = useLang();
const { status, init, subscribe, unsubscribe, syncReaderBinding } = usePushSubscription();
const { isAuthenticated } = useReaderAuth();

onMounted(() => {
	init();
});

// Re-bind an existing (previously anonymous) subscription whenever the reader
// is signed in AND the browser subscription is detected. Safe no-op when there
// is none / not subscribed; the backend keeps reader_id on anonymous re-stamp,
// so logout leaves the browser-level subscription untouched (DEC-064).
//
// The combined immediate watch is the ISS-112 fix: an isAuthenticated-only,
// non-immediate watch left anonymous subscriptions unbound forever —
//  (a) a reader already signed in on load (stored token) never transitions
//      false->true, so the re-stamp never ran; and
//  (b) the re-stamp needs `status === "subscribed"`, which is only known after
//      the async init() settles, so firing on sign-in alone hit the guard too
//      early and silently no-oped.
// Watching both refs (immediate covers the already-set initial state) means the
// first moment both hold true triggers the bind; redundant firings are harmless
// — syncBackend subscribe is an endpoint-keyed upsert and syncReaderBinding
// guards on status itself. Once bound, the reader's new_post opt-out (DEC-171)
// filters this subscription the same way it filters the inbox row.
watch(
	[isAuthenticated, status],
	([signedIn, currentStatus]) => {
		if (signedIn && currentStatus === "subscribed") void syncReaderBinding();
	},
	{ immediate: true },
);

const visible = computed(() => status.value !== "unsupported" && status.value !== "unconfigured");
const busy = computed(() => status.value === "subscribing" || status.value === "unsubscribing");

const label = computed(() => {
	switch (status.value) {
		case "subscribed":
			return t("common.push.subscribed");
		case "denied":
			return t("common.push.denied");
		case "subscribing":
			return t("common.push.subscribing");
		case "unsubscribing":
			return t("common.push.unsubscribing");
		default:
			return t("common.push.subscribe");
	}
});

const icon = computed(() => {
	switch (status.value) {
		case "subscribed":
			return "lucide:bell-ring";
		case "denied":
			return "lucide:bell-off";
		case "subscribing":
		case "unsubscribing":
			return "lucide:loader-2";
		default:
			return "lucide:bell";
	}
});

// Tooltip advertises the reply-notification benefit for signed-in readers;
// anonymous visitors just see the base label.
const hint = computed(() => (isAuthenticated.value ? ` · ${t("common.push.repliesIn")}` : ""));
const title = computed(() => `${label.value}${hint.value}`);

async function onClick() {
	if (busy.value) return;
	if (status.value === "subscribed") await unsubscribe();
	else await subscribe();
}
</script>

<template>
  <button
    v-if="visible"
    type="button"
    :disabled="status === 'denied' || busy"
    :title="title"
    :aria-label="label"
    class="inline-flex shrink-0 items-center gap-1.5 p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200 transition-all duration-200 disabled:opacity-50"
    @click="onClick"
  >
    <Icon :icon="icon" class="w-4 h-4" :class="{ 'animate-spin': busy }" />
    <span class="hidden lg:inline text-sm">{{ label }}</span>
  </button>
</template>
