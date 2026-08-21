<script setup lang="ts">
/**
 * Admin sidebar toggle for comment-moderation alerts (DEC-080, TASK-152).
 *
 * An admin (superuser or editor) opts this browser into a Web Push that fires
 * the moment a new comment awaits approval (deep-links to /admin/comments).
 * The blog moderates every comment, so this replaces re-opening the
 * moderation queue to discover pending comments.
 *
 * Delivery gating mirrors ThreadSubscribeButton: the toggle always renders in
 * the admin sidebar (an admin-only settings surface) but is disabled with an
 * explanatory hint whenever delivery is impossible (unsupported/unconfigured/
 * denied) — never a silent no-op opt-in. Under the repo's default `just e2e`
 * harness (no VAPID) the toggle reads disabled with the hint.
 */
import { useAdminPushSubscription } from "~~/composables/useAdminPushSubscription";

const { t } = useLang();
const { status, init, subscribe, unsubscribe } = useAdminPushSubscription();

onMounted(() => {
	void init();
});

const busy = computed(() => status.value === "subscribing" || status.value === "unsubscribing");
// No delivery is possible: unsupported/unconfigured/denied all mean a click
// could never "just work", so disable + hint instead of silently failing.
const pushBlocked = computed(() =>
	["unsupported", "unconfigured", "denied"].includes(status.value),
);

const label = computed(() => {
	switch (status.value) {
		case "subscribed":
			return t("admin.moderationPush.subscribed");
		case "denied":
			return t("admin.moderationPush.denied");
		case "subscribing":
			return t("admin.moderationPush.subscribing");
		case "unsubscribing":
			return t("admin.moderationPush.unsubscribing");
		default:
			return t("admin.moderationPush.subscribe");
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

async function onClick() {
	if (busy.value) return;
	if (status.value === "subscribed") await unsubscribe();
	else await subscribe();
}
</script>

<template>
  <div class="px-4 py-2.5">
    <button
      type="button"
      :disabled="pushBlocked || busy"
      :title="pushBlocked ? t('admin.moderationPush.hint') : label"
      :aria-pressed="status === 'subscribed' ? 'true' : 'false'"
      :aria-label="label"
      class="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 transition-all duration-200 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
      @click="onClick"
    >
      <Icon :icon="icon" class="h-4 w-4" :class="{ 'animate-spin': busy }" />
      <span>{{ label }}</span>
    </button>
    <p class="mt-1 px-4 text-xs text-gray-400 dark:text-gray-500">
      {{ t('admin.moderationPush.hint') }}
    </p>
  </div>
</template>
