<script setup lang="ts">
/**
 * Reader notification inbox page (DEC-160, TASK-192).
 *
 * Lists a signed-in reader's durable notifications newest-first with read/unread
 * state, kind labels, deep-links to the source (post / post + comment anchor),
 * a single mark-all-read action, and an empty state. Guests are redirected to
 * /login (the inbox is auth-scoped). Unlike the fire-and-forget browser push,
 * these rows persist server-side so a reader can review activity they missed.
 */
import { onMounted, ref } from "vue";
import {
	fetchReaderNotifications,
	markAllReaderNotificationsRead,
	markReaderNotificationRead,
	type ReaderNotification,
} from "~~/composables/useApi";
import { useReaderAuth } from "~~/composables/useReaderAuth";
import { useSeo } from "~~/composables/useSeo";

const { t, locale } = useLang();
const { isAuthenticated } = useReaderAuth();
const router = useRouter();

useSeo({
	title: t("notifications.seoTitle"),
	description: t("notifications.seoDesc"),
	path: "/notifications",
});

const items = ref<ReaderNotification[]>([]);
const unread = ref(0);
const loading = ref(false);
const error = ref(false);

async function load() {
	if (!isAuthenticated.value) return;
	loading.value = true;
	error.value = false;
	try {
		const data = await fetchReaderNotifications(1, 100);
		items.value = data.items;
		unread.value = data.unread;
	} catch {
		error.value = true;
	} finally {
		loading.value = false;
	}
}

onMounted(() => {
	if (!isAuthenticated.value) {
		void router.replace("/login");
		return;
	}
	void load();
});

async function markRead(item: ReaderNotification) {
	if (item.read) return;
	try {
		const updated = await markReaderNotificationRead(item.id);
		item.read = true;
		item.read = updated.read;
		if (unread.value > 0) unread.value -= 1;
	} catch {
		/* best effort — the row stays unread */
	}
}

async function markAllRead() {
	if (unread.value === 0) return;
	try {
		await markAllReaderNotificationsRead();
		unread.value = 0;
		items.value.forEach((i) => {
			i.read = true;
		});
	} catch {
		/* best effort */
	}
}

function kindLabel(item: ReaderNotification): string {
	const key = `notifications.kind.${item.kind}`;
	return t(key) === key ? item.title : t(key);
}

function timeLabel(item: ReaderNotification): string {
	if (!item.created_at) return "";
	const d = new Date(item.created_at);
	const fmt = new Intl.DateTimeFormat(locale.value === "zh" ? "zh-CN" : "en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
	return fmt.format(d);
}

function kindIcon(kind: string): string {
	if (kind === "reply") return "lucide:message-square";
	if (kind === "thread_comment") return "lucide:message-circle";
	if (kind === "series_new_part") return "lucide:layers";
	return "lucide:file-text";
}
</script>

<template>
  <div class="max-w-3xl mx-auto">
    <div class="flex flex-wrap items-center justify-between gap-4 mb-8">
      <div>
        <h1 class="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Icon icon="lucide:bell" class="w-7 h-7 text-amber-500" />
          {{ t('notifications.title') }}
        </h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {{ t('notifications.seoDesc') }}
        </p>
      </div>
      <button
        v-if="unread > 0"
        type="button"
        class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-all duration-200"
        @click="markAllRead"
      >
        <Icon icon="lucide:check-check" class="w-4 h-4" />
        {{ t('notifications.markAllRead') }}
      </button>
    </div>

    <p v-if="error" class="mb-4 text-sm text-red-600 dark:text-red-400">
      {{ t('common.errors.network') }}
    </p>

    <div v-if="loading" class="py-12 text-center text-gray-400">
      <Icon icon="lucide:loader-2" class="w-8 h-8 animate-spin mx-auto" />
    </div>

    <div v-else-if="items.length === 0" class="py-16 text-center">
      <Icon icon="lucide:bell-off" class="w-12 h-12 text-gray-300 dark:text-gray-700 mx-auto mb-4" />
      <p class="text-lg font-semibold text-gray-700 dark:text-gray-300">{{ t('notifications.empty') }}</p>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ t('notifications.emptyDesc') }}</p>
    </div>

    <ul v-else class="space-y-3">
      <li
        v-for="item in items"
        :key="item.id"
        class="rounded-xl border transition-colors"
        :class="item.read
          ? 'border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900'
          : 'border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20'"
      >
        <a :href="item.url || undefined" class="flex items-start gap-3 p-4" @click="markRead(item)">
          <Icon :icon="kindIcon(item.kind)" class="w-5 h-5 mt-0.5 shrink-0 text-amber-500" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="text-sm text-amber-600 dark:text-amber-400">{{ kindLabel(item) }}</span>
              <span v-if="!item.read" class="shrink-0 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400">
                {{ t('notifications.unread') }}
              </span>
            </div>
            <p class="mt-0.5 text-sm font-medium text-gray-900 dark:text-gray-100">{{ item.title }}</p>
            <p v-if="item.body" class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{{ item.body }}</p>
            <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">{{ timeLabel(item) }}</p>
          </div>
          <button
            v-if="!item.read"
            type="button"
            class="shrink-0 self-center text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline"
            @click.stop="markRead(item)"
          >
            {{ t('notifications.markRead') }}
          </button>
        </a>
      </li>
    </ul>
  </div>
</template>
