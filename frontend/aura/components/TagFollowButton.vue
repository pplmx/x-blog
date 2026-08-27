<script setup lang="ts">
/**
 * Inline tag-follow control (DEC-196/TASK-216).
 *
 * Attaches to a tag chip on the reading surface so a signed-in reader can
 * follow/unfollow the tag and toggle its new-post notifications in place,
 * instead of leaving the page for /tags. Renders nothing for guests, so the
 * surrounding chip looks unchanged for anonymous readers. Follow state comes
 * from the shared useTagFollowStore (one list fetch for every chip on a page).
 */
import { computed, onMounted } from "vue";
import { useLang } from "~~/composables/useLang";
import { useTagFollowStore } from "~~/composables/useTagFollowStore";

defineOptions({ name: "TagFollowButton" });

const props = defineProps<{
	tagId: number;
	tagName: string;
}>();

const { t } = useLang();
const store = useTagFollowStore();

// Same synchronous localStorage gate the /tags page follow control uses; in
// SSR there is no browser storage, so the buttons never render server-side.
const signedIn = computed(() => {
	if (typeof window === "undefined") return false;
	return !!window.localStorage?.getItem("reader_token");
});

const following = store.following(props.tagId);
const notify = store.notify(props.tagId);
const busy = store.busy(props.tagId);

onMounted(() => {
	store.ensureLoaded().catch(() => {});
});

// Keep the chip's last state on failure: the store clears its busy flag in a
// finally, so a failed follow/unfollow/notify leaves the button consistent
// instead of throwing an unhandled rejection from a click handler.
function handleToggleFollow() {
	store.toggleFollow(props.tagId).catch(() => {});
}

function handleSetNotify() {
	store.setNotify(props.tagId, !notify.value).catch(() => {});
}
</script>

<template>
	<span
		v-if="signedIn"
		class="inline-flex items-center"
		:title="tagName"
		@click.stop.prevent
	>
		<button
			type="button"
			:disabled="busy"
			:title="`${tagName} ${t(following ? 'tags.followingTitle' : 'tags.followTitle')}`"
			:aria-label="`${tagName} ${t(following ? 'tags.followingTitle' : 'tags.followTitle')}`"
			class="inline-flex items-center p-1 rounded-full text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors disabled:opacity-40"
			@click="handleToggleFollow"
		>
			<Icon :icon="following ? 'lucide:bookmark-check' : 'lucide:bookmark'" class="w-3.5 h-3.5" />
		</button>
		<button
			v-if="following"
			type="button"
			:disabled="busy"
			:title="`${tagName} ${t('tags.notifyTitle')}`"
			:aria-label="`${tagName} ${t(notify ? 'tags.notifyOn' : 'tags.notifyOff')}`"
			class="inline-flex items-center p-1 rounded-full text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors disabled:opacity-40"
			@click="handleSetNotify"
		>
			<Icon :icon="notify ? 'lucide:bell' : 'lucide:bell-off'" class="w-3.5 h-3.5" />
		</button>
	</span>
</template>
