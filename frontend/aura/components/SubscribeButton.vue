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

// A transient subscribe/unsubscribe failure flashes a short error bubble. The
// push composable RETHROWS on failure (per-call-site surfacing — a shared error
// ref previously made a comment-thread/category follow failure flash this
// header button, the wrong widget), so this component owns its error state and
// catches at its own click boundary.
const errorVisible = ref(false);
let errorTimer: ReturnType<typeof setTimeout> | undefined;
function flashError() {
	errorVisible.value = true;
	clearTimeout(errorTimer);
	errorTimer = setTimeout(() => {
		errorVisible.value = false;
	}, 2600);
}

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

// Compact (desktop header nav) hides the text below 2xl — the nav row is tight
// at xl once a reader is signed in (English). Everywhere else (mobile menu,
// which only ever shows below xl) keeps the full label: an unconditional
// `hidden 2xl:inline` would leave the mobile-menu button icon-only forever
// since the menu never reaches 2xl. (ISS-125/TASK-225)
const props = defineProps<{ compact?: boolean }>();

async function onClick() {
	if (busy.value) return;
	try {
		if (status.value === "subscribed") await unsubscribe();
		else await subscribe();
	} catch {
		flashError();
	}
}
</script>

<template>
  <span v-if="visible" class="relative inline-flex shrink-0">
    <!-- Transient push-failure bubble (ISS-215): a failed subscribe/unsubscribe
         is announced via role=alert instead of silently reverting. Anchored
         absolutely so it never shifts the header row. -->
    <span
      v-if="errorVisible"
      role="alert"
      class="absolute bottom-full left-1/2 z-20 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/40 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400 shadow-sm"
    >
      {{ t("common.push.subscribeFailed") }}
    </span>
    <button
      type="button"
      :disabled="status === 'denied' || busy"
      :title="title"
      :aria-label="label"
      class="inline-flex items-center gap-1.5 p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200 transition-all duration-200 disabled:opacity-50"
      @click="onClick"
    >
      <Icon :icon="icon" class="w-4 h-4" :class="{ 'animate-spin': busy }" />
      <!-- Compact (header) icon-only below 2xl: at xl the header row is tight
           (English + signed-in + the wide "blocked" label would overflow), so
           the text shows only on very wide screens; the tooltip/aria-label
           always keep it meaningful. Non-compact (mobile menu) always shows the
           text. (ISS-125/TASK-225) -->
      <span class="text-sm" :class="props.compact ? 'hidden 2xl:inline' : 'inline'">{{ label }}</span>
    </button>
  </span>
</template>
