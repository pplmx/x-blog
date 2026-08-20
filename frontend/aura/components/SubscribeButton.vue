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

// Re-bind an existing subscription when a reader signs in (safe no-op when
// there is none / not subscribed; the backend keeps reader_id on anonymous
// re-stamp, so logout leaves the browser-level subscription untouched).
watch(isAuthenticated, (signedIn) => {
	if (signedIn) void syncReaderBinding();
});

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
const hint = computed(() =>
	isAuthenticated.value ? ` · ${t("common.push.repliesIn")}` : "",
);
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
