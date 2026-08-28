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
import { computed, onMounted, ref } from "vue";
import {
	getReaderNotificationPrefs,
	getReaderNotifications,
	markAllReaderNotificationsRead,
	markReaderNotificationRead,
	type ReaderNotification,
	type ReaderNotificationPrefs,
	updateReaderNotificationPref,
} from "~~/api/reader/notifications";
import { useNotificationBadge } from "~~/composables/useNotificationBadge";
import { useReaderAuth } from "~~/composables/useReaderAuth";
import { useSeo } from "~~/composables/useSeo";

const { t, locale } = useLang();
const { isAuthenticated, logout } = useReaderAuth();
const router = useRouter();

// The nav badge and this inbox share one count (ISS-124, TASK-224): every
// read/mark-all action re-fetches the shared count from the server (not a
// locally-decremented guess) so the header badge drop never overwrites a
// fresher value the layout's 60s poll already fetched.
const { refresh: refreshBadge } = useNotificationBadge();

useSeo({
	title: t("notifications.seoTitle"),
	description: t("notifications.seoDesc"),
	path: "/notifications",
});

const items = ref<ReaderNotification[]>([]);
const unread = ref(0);
const loading = ref(false);
const error = ref(false);

// Per-kind preferences (DEC-171, TASK-202). A reader who turns a kind off stops
// receiving it everywhere (inbox row + push), via the server gate.
const prefs = ref<ReaderNotificationPrefs | null>(null);
const prefsError = ref(false);
const prefsSaving = ref<keyof ReaderNotificationPrefs | null>(null);

/** True when a 401 means an expired/invalid reader session (see ISS-110). */
function isStaleSession(cause: unknown): boolean {
	return (
		(cause as { statusCode?: number } | undefined)?.statusCode === 401 ||
		(cause as { response?: { status?: number } } | undefined)?.response?.status === 401
	);
}

async function load() {
	if (!isAuthenticated.value) return;
	loading.value = true;
	error.value = false;
	try {
		const data = await getReaderNotifications(1, 100);
		items.value = data.items;
		unread.value = data.unread;
		void refreshBadge();
	} catch (cause) {
		// The inbox is auth-scoped: a 401 means the stored reader token is
		// expired/invalid, not a transient outage. Drop the stale session and
		// send the reader back to sign-in (same route as the guest redirect)
		// instead of surfacing a misleading network error. (ISS-110, TASK-198)
		if (isStaleSession(cause)) {
			logout();
			void router.replace("/login");
			return;
		}
		error.value = true;
	} finally {
		loading.value = false;
	}
}

async function loadPrefs() {
	if (!isAuthenticated.value) return;
	try {
		prefs.value = await getReaderNotificationPrefs();
		prefsError.value = false;
	} catch (cause) {
		if (isStaleSession(cause)) {
			logout();
			void router.replace("/login");
			return;
		}
		// Non-fatal: the inbox still renders; the card just shows its error hint.
		prefsError.value = true;
	}
}

async function savePref(kind: keyof ReaderNotificationPrefs, enabled: boolean) {
	prefsSaving.value = kind;
	try {
		prefs.value = await updateReaderNotificationPref(kind, enabled);
		prefsError.value = false;
	} catch (cause) {
		if (isStaleSession(cause)) {
			logout();
			void router.replace("/login");
			return;
		}
		// Roll the toggle back to the server-confirmed state and surface the hint.
		prefsError.value = true;
		if (prefs.value) prefs.value[kind] = !enabled;
	} finally {
		prefsSaving.value = null;
	}
}

function togglePref(kind: keyof ReaderNotificationPrefs) {
	if (!prefs.value || prefsSaving.value !== null) return;
	prefs.value[kind] = !prefs.value[kind];
	void savePref(kind, prefs.value[kind]);
}

type PrefKind = keyof ReaderNotificationPrefs;

const prefRows = computed(() => {
	if (!prefs.value) return [];
	const rows: Array<{ key: PrefKind; icon: string; label: string; desc: string; on: boolean }> = [
		{
			key: "new_post",
			icon: "lucide:file-text",
			label: t("notifications.prefs.kind.new_post.label"),
			desc: t("notifications.prefs.kind.new_post.desc"),
			on: prefs.value.new_post,
		},
		{
			key: "reply",
			icon: "lucide:message-square",
			label: t("notifications.prefs.kind.reply.label"),
			desc: t("notifications.prefs.kind.reply.desc"),
			on: prefs.value.reply,
		},
		{
			key: "thread_comment",
			icon: "lucide:message-circle",
			label: t("notifications.prefs.kind.thread_comment.label"),
			desc: t("notifications.prefs.kind.thread_comment.desc"),
			on: prefs.value.thread_comment,
		},
		{
			key: "email_new_post",
			icon: "lucide:mail",
			label: t("notifications.prefs.kind.email_new_post.label"),
			desc: t("notifications.prefs.kind.email_new_post.desc"),
			on: prefs.value.email_new_post,
		},
		{
			key: "email_reply",
			icon: "lucide:mail-reply",
			label: t("notifications.prefs.kind.email_reply.label"),
			desc: t("notifications.prefs.kind.email_reply.desc"),
			on: prefs.value.email_reply,
		},
		{
			key: "email_thread_comment",
			icon: "lucide:at-sign",
			label: t("notifications.prefs.kind.email_thread_comment.label"),
			desc: t("notifications.prefs.kind.email_thread_comment.desc"),
			on: prefs.value.email_thread_comment,
		},
		{
			key: "email_weekly_digest",
			icon: "lucide:calendar-clock",
			label: t("notifications.prefs.kind.email_weekly_digest.label"),
			desc: t("notifications.prefs.kind.email_weekly_digest.desc"),
			on: prefs.value.email_weekly_digest,
		},
	];
	return rows;
});

onMounted(() => {
	if (!isAuthenticated.value) {
		void router.replace("/login");
		return;
	}
	void load();
	void loadPrefs();
});

async function markRead(item: ReaderNotification) {
	if (item.read) return;
	try {
		const updated = await markReaderNotificationRead(item.id);
		item.read = updated.read;
		if (unread.value > 0) unread.value -= 1;
		void refreshBadge();
	} catch {
		/* best effort — the row stays unread */
	}
}

async function markAllRead() {
	if (unread.value === 0) return;
	try {
		await markAllReaderNotificationsRead();
		unread.value = 0;
		void refreshBadge();
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

    <section
      v-if="isAuthenticated"
      class="mb-8 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5"
    >
      <h2 class="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
        <Icon icon="lucide:settings-2" class="w-4 h-4 text-amber-500" />
        {{ t('notifications.prefs.title') }}
      </h2>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {{ t('notifications.prefs.subtitle') }}
      </p>
      <ul class="mt-4 space-y-4">
        <li v-for="row in prefRows" :key="row.key" class="flex items-start justify-between gap-4">
          <div class="flex items-start gap-3">
            <Icon :icon="row.icon" class="w-5 h-5 mt-0.5 shrink-0 text-amber-500" />
            <div>
              <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ row.label }}</p>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ row.desc }}</p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="row.on ? 'true' : 'false'"
            :aria-label="row.label"
            :disabled="prefsSaving !== null"
            class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60"
            :class="row.on
              ? 'bg-amber-500'
              : 'bg-gray-200 dark:bg-gray-700'"
            @click="togglePref(row.key)"
          >
            <span
              class="inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200"
              :class="row.on ? 'translate-x-[22px]' : 'translate-x-0.5'"
            />
          </button>
        </li>
      </ul>
      <p v-if="prefsError" class="mt-3 text-xs text-red-600 dark:text-red-400">
        {{ t('common.errors.network') }}
      </p>
    </section>

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
