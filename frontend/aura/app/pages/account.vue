<script setup lang="ts">
import { parseApiDate } from "~~/composables/apiDate";
/**
 * Reader account settings (DEC-067, TASK-142): edit display name, rotate the
 * password (verifying the current one; the fresh token keeps this session
 * alive while the version bump signs other sessions out), and see/revoke the
 * browser push devices bound to the account.
 */

import type { Category } from "~~/api/contracts/shared";
import { getCategories } from "~~/api/public/taxonomy";
import {
	changeReaderPassword,
	deleteReaderAccount,
	getReaderDataExport,
	updateReaderProfile,
} from "~~/api/reader/account";
import type {
	FollowedCategoryItem,
	FollowedSeriesItem,
	FollowedTagItem,
} from "~~/api/reader/follows";
import {
	getReaderCategoryFollows,
	getReaderSeriesFollows,
	getReaderTagFollows,
	setCategoryFollowNotify,
	setSeriesFollowNotify,
	setTagFollowNotify,
	unfollowReaderCategory,
	unfollowReaderSeries,
	unfollowReaderTag,
} from "~~/api/reader/follows";
import {
	getMyPushSubscriptions,
	type ReaderPushSubscription,
	revokeMyPushSubscription,
	updateMyPushSubscriptionPrefs,
} from "~~/api/reader/notifications";
import {
	getMyPostSubscriptions,
	type SubscribedThreadItem,
	unsubscribeFromPostThread,
} from "~~/api/reader/subscriptions";
import { useReaderAuth } from "~~/composables/useReaderAuth";
import { useSeo } from "~~/composables/useSeo";

const { t, locale } = useLang();
const { isAuthenticated, reader, setProfile, updateToken, logout, isStaleSession } =
	useReaderAuth();

useSeo({
	title: t("account.seoTitle"),
	description: t("account.seoDesc"),
	path: "/account",
});

/* Profile --------------------------------------------------------------- */
const displayName = ref(reader.value?.display_name ?? "");
const savingProfile = ref(false);
const profileSaved = ref(false);
const profileFailed = ref(false);

async function saveProfileName() {
	const name = displayName.value.trim();
	if (!name) return; // guard before touching state so Save never sticks disabled (ISS-127)
	savingProfile.value = true;
	profileSaved.value = false;
	profileFailed.value = false;
	try {
		const updated = await updateReaderProfile({ display_name: name });
		setProfile(updated);
		displayName.value = updated.display_name ?? "";
		profileSaved.value = true;
	} catch {
		profileFailed.value = true;
	} finally {
		savingProfile.value = false;
	}
}

/* Password -------------------------------------------------------------- */
const pw = ref({ current: "", next: "", confirm: "" });
const passwordState = ref<"idle" | "busy" | "success" | "wrong" | "mismatch" | "short" | "failed">(
	"idle",
);

async function submitPassword() {
	const next = pw.value.next;
	if (next.length < 8) {
		passwordState.value = "short";
		return;
	}
	if (next !== pw.value.confirm) {
		passwordState.value = "mismatch";
		return;
	}
	passwordState.value = "busy";
	try {
		const session = await changeReaderPassword({
			current_password: pw.value.current,
			new_password: next,
		});
		// The version bump invalidates the stored token — persist the fresh one
		// so this session stays signed in while other devices are signed out.
		updateToken(session);
		pw.value = { current: "", next: "", confirm: "" };
		passwordState.value = "success";
	} catch (err) {
		// /me/password 401s twice: an expired/revoked token (auth dependency —
		// a dead session must send the reader back to sign-in, NOT claim their
		// current password was wrong) and an incorrect current password (a
		// form-level error). isStaleSession distinguishes them by detail.
		if (isStaleSession(err)) {
			logout();
			void navigateTo("/login");
			return;
		}
		passwordState.value = statusOf(err) === 401 ? "wrong" : "failed";
	}
}

/* Push devices ---------------------------------------------------------- */
const devices = ref<ReaderPushSubscription[]>([]);
const devicesLoaded = ref(false);
const devicesLoadFailed = ref(false);
const revokingId = ref<number | null>(null);
const deviceError = ref(false);

/** Shared catch for the account page's reader-scoped loads: an expired/revoked
 * reader JWT 401s every reader endpoint at once (they share the auth
 * dependency), so without this the whole page sits in per-section "Failed to
 * load" states whose Retry can never succeed while still looking signed-in.
 * Route to sign-in on a stale session (notifications.vue + the password/delete
 * flows already do this); any other failure just marks that section failed. */
function handleLoadFailure(err: unknown, markFailed: () => void): void {
	if (isStaleSession(err)) {
		logout();
		void navigateTo("/login");
		return;
	}
	markFailed();
}

async function loadDevices() {
	if (!isAuthenticated.value) return;
	devicesLoadFailed.value = false;
	try {
		const data = await getMyPushSubscriptions();
		devices.value = data.items;
	} catch (err) {
		devices.value = [];
		handleLoadFailure(err, () => {
			devicesLoadFailed.value = true;
		});
	}
	devicesLoaded.value = true;
}

async function revokeDevice(device: ReaderPushSubscription) {
	if (!confirm(t("account.devices.revokeConfirm"))) return;
	revokingId.value = device.id;
	deviceError.value = false;
	try {
		await revokeMyPushSubscription(device.id);
		await loadDevices();
	} catch {
		deviceError.value = true;
	} finally {
		revokingId.value = null;
	}
}

/* New-post notification prefs (DEC-076, TASK-147) ------------------------- */
const categories = ref<Category[]>([]);
const savingPrefsId = ref<number | null>(null);
const prefsError = ref(false);

// The public /api/categories list drives the "followed category" options for
// every device. Loaded on mount via $fetch (not useFetch) so setup stays
// synchronous and tests can mock getCategories like any taxonomy helper.
async function loadCategories() {
	try {
		categories.value = await getCategories();
	} catch {
		categories.value = [];
	}
}

/** Toggle the device's new-post opt-in (null scope = all new posts). */
async function setDeviceNewPosts(device: ReaderPushSubscription, want: boolean) {
	prefsError.value = false;
	savingPrefsId.value = device.id;
	try {
		await updateMyPushSubscriptionPrefs(device.id, {
			want_new_posts: want,
			new_post_category_id: want ? device.new_post_category_id : null,
		});
		device.want_new_posts = want;
	} catch {
		prefsError.value = true;
	} finally {
		savingPrefsId.value = null;
	}
}

/** Pin a device's follow to one category (or null for all new posts). */
async function setDeviceFollowCategory(device: ReaderPushSubscription, categoryId: number | null) {
	prefsError.value = false;
	savingPrefsId.value = device.id;
	try {
		await updateMyPushSubscriptionPrefs(device.id, {
			want_new_posts: true,
			new_post_category_id: categoryId,
		});
		device.new_post_category_id = categoryId;
		device.want_new_posts = true;
	} catch {
		prefsError.value = true;
	} finally {
		savingPrefsId.value = null;
	}
}

/** Template binding: checkbox change -> new-post opt-in toggle. */
function onDeviceNewPostsChange(device: ReaderPushSubscription, event: Event) {
	const want = (event.target as HTMLInputElement | null)?.checked ?? false;
	return setDeviceNewPosts(device, want);
}

/** Template binding: category select change -> pin/clear the follow scope. */
function onDeviceCategoryChange(device: ReaderPushSubscription, event: Event) {
	const value = (event.target as HTMLSelectElement | null)?.value ?? "";
	return setDeviceFollowCategory(device, value ? Number(value) : null);
}

/* Followed discussions (DEC-078, TASK-150) -------------------------------- */
const threads = ref<SubscribedThreadItem[]>([]);
const threadsLoaded = ref(false);
const threadsLoadFailed = ref(false);
const unsubscribingId = ref<number | null>(null);
const threadsError = ref(false);

async function loadThreads() {
	if (!isAuthenticated.value) return;
	threadsLoadFailed.value = false;
	try {
		const data = await getMyPostSubscriptions();
		threads.value = data.items;
	} catch (err) {
		threads.value = [];
		handleLoadFailure(err, () => {
			threadsLoadFailed.value = true;
		});
	}
	threadsLoaded.value = true;
}

/** Unfollow a discussion (unsubscribes on the post-scoped toggle endpoint). */
async function unfollowThread(thread: SubscribedThreadItem) {
	if (!confirm(t("account.threads.unfollowConfirm"))) return;
	unsubscribingId.value = thread.id;
	threadsError.value = false;
	try {
		await unsubscribeFromPostThread(thread.id);
		await loadThreads();
	} catch {
		threadsError.value = true;
	} finally {
		unsubscribingId.value = null;
	}
}

/* Followed series for new-part push (DEC-134, TASK-179) -------------------- */
const seriesFollows = ref<FollowedSeriesItem[]>([]);
const seriesFollowsLoaded = ref(false);
const seriesFollowsLoadFailed = ref(false);
const seriesUnfollowId = ref<number | null>(null);
const seriesNotifyId = ref<number | null>(null);
const seriesFollowsError = ref(false);

async function loadSeriesFollows() {
	if (!isAuthenticated.value) return;
	seriesFollowsLoadFailed.value = false;
	try {
		seriesFollows.value = (await getReaderSeriesFollows()).items ?? [];
	} catch (err) {
		seriesFollows.value = [];
		handleLoadFailure(err, () => {
			seriesFollowsLoadFailed.value = true;
		});
	}
	seriesFollowsLoaded.value = true;
}

async function unfollowFollowedSeries(item: FollowedSeriesItem) {
	if (!confirm(t("account.series.unfollowConfirm"))) return;
	seriesUnfollowId.value = item.id;
	seriesFollowsError.value = false;
	try {
		await unfollowReaderSeries(item.id);
		await loadSeriesFollows();
	} catch {
		seriesFollowsError.value = true;
	} finally {
		seriesUnfollowId.value = null;
	}
}

/** Toggle new-part push on/off for a followed series (TASK-181). */
async function toggleSeriesNotify(item: FollowedSeriesItem) {
	if (seriesNotifyId.value != null) return;
	seriesNotifyId.value = item.id;
	seriesFollowsError.value = false;
	const next = !item.notify;
	try {
		const res = await setSeriesFollowNotify(item.id, next);
		item.notify = res?.notify ?? next;
	} catch {
		seriesFollowsError.value = true;
	} finally {
		seriesNotifyId.value = null;
	}
}

/* Followed categories for new-post push (DEC-140, TASK-182) --------------- */
const categoryFollows = ref<FollowedCategoryItem[]>([]);
const categoryFollowsLoaded = ref(false);
const categoryFollowsLoadFailed = ref(false);
const categoryUnfollowId = ref<number | null>(null);
const categoryNotifyId = ref<number | null>(null);
const categoryFollowsError = ref(false);

async function loadCategoryFollows() {
	if (!isAuthenticated.value) return;
	categoryFollowsLoadFailed.value = false;
	try {
		categoryFollows.value = (await getReaderCategoryFollows()).items ?? [];
	} catch (err) {
		categoryFollows.value = [];
		handleLoadFailure(err, () => {
			categoryFollowsLoadFailed.value = true;
		});
	}
	categoryFollowsLoaded.value = true;
}

async function unfollowFollowedCategory(item: FollowedCategoryItem) {
	if (!confirm(t("account.categories.unfollowConfirm"))) return;
	categoryUnfollowId.value = item.id;
	categoryFollowsError.value = false;
	try {
		await unfollowReaderCategory(item.id);
		await loadCategoryFollows();
	} catch {
		categoryFollowsError.value = true;
	} finally {
		categoryUnfollowId.value = null;
	}
}

async function toggleCategoryNotify(item: FollowedCategoryItem) {
	if (categoryNotifyId.value != null) return;
	categoryNotifyId.value = item.id;
	categoryFollowsError.value = false;
	const next = !item.notify;
	try {
		const res = await setCategoryFollowNotify(item.id, next);
		item.notify = res?.notify ?? next;
	} catch {
		categoryFollowsError.value = true;
	} finally {
		categoryNotifyId.value = null;
	}
}

/* Followed tags for new-post push (DEC-195, TASK-215) ---------------------- */
const tagFollows = ref<FollowedTagItem[]>([]);
const tagFollowsLoaded = ref(false);
const tagFollowsLoadFailed = ref(false);
const tagUnfollowId = ref<number | null>(null);
const tagNotifyId = ref<number | null>(null);
const tagFollowsError = ref(false);

async function loadTagFollows() {
	if (!isAuthenticated.value) return;
	tagFollowsLoadFailed.value = false;
	try {
		tagFollows.value = (await getReaderTagFollows()).items ?? [];
	} catch (err) {
		tagFollows.value = [];
		handleLoadFailure(err, () => {
			tagFollowsLoadFailed.value = true;
		});
	}
	tagFollowsLoaded.value = true;
}

async function unfollowFollowedTag(item: FollowedTagItem) {
	if (!confirm(t("account.tags.unfollowConfirm"))) return;
	tagUnfollowId.value = item.id;
	tagFollowsError.value = false;
	try {
		await unfollowReaderTag(item.id);
		await loadTagFollows();
	} catch {
		tagFollowsError.value = true;
	} finally {
		tagUnfollowId.value = null;
	}
}

async function toggleTagNotify(item: FollowedTagItem) {
	if (tagNotifyId.value != null) return;
	tagNotifyId.value = item.id;
	tagFollowsError.value = false;
	const next = !item.notify;
	try {
		const res = await setTagFollowNotify(item.id, next);
		item.notify = res?.notify ?? next;
	} catch {
		tagFollowsError.value = true;
	} finally {
		tagNotifyId.value = null;
	}
}

/* Delete account (DEC-106, TASK-165) ---------------------------------- */
// Data export (DEC-126, TASK-175): download the reader's portable JSON bundle.
const exportingData = ref(false);
const exportState = ref<"idle" | "done" | "failed">("idle");

async function downloadMyData() {
	if (exportingData.value) return;
	if (!confirm(t("account.export.confirm"))) return;
	exportingData.value = true;
	exportState.value = "idle";
	try {
		const data = await getReaderDataExport();
		if (!data) throw new Error("empty export");
		const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "xblog-my-data.json";
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		exportState.value = "done";
	} catch {
		exportState.value = "failed";
	} finally {
		exportingData.value = false;
	}
}

const deletePassword = ref("");
const deletingAccount = ref(false);
const deleteError = ref<{ code: "wrong" | "failed" } | null>(null);

async function deleteAccount() {
	if (deletingAccount.value) return;
	if (!confirm(t("account.deleteAccount.confirm"))) return;
	if (!deletePassword.value) return;
	deletingAccount.value = true;
	deleteError.value = null;
	try {
		await deleteReaderAccount(deletePassword.value);
		logout();
		navigateTo("/");
	} catch (e) {
		// Same dual-401 as the password change: an expired/revoked token is a
		// dead session, not a wrong password.
		if (isStaleSession(e)) {
			logout();
			void navigateTo("/login");
			return;
		}
		deleteError.value = { code: statusOf(e) === 401 ? "wrong" : "failed" };
	} finally {
		deletingAccount.value = false;
	}
}

/**
 * Extract an HTTP status from a rejected API call whether the error carries
 * ofetch's `.status`/`.statusCode` or the plain response shape. Used to tell a
 * wrong-password 401 (form error) from other failures once isStaleSession has
 * ruled out a dead session.
 */
function statusOf(err: unknown): number | undefined {
	const e = err as { status?: number; statusCode?: number } | undefined;
	return e?.status ?? e?.statusCode;
}

onMounted(() => {
	loadDevices();
	loadCategories();
	loadThreads();
	loadSeriesFollows();
	loadCategoryFollows();
	loadTagFollows();
	// Keep the name input in sync if the header "reader" profile loads after us.
	displayName.value = reader.value?.display_name ?? displayName.value;
});

function formatDate(dateStr: string | null): string {
	if (!dateStr) return "—";
	return (
		parseApiDate(dateStr)?.toLocaleDateString(locale.value === "zh" ? "zh-CN" : "en-US", {
			year: "numeric",
			month: "short",
			day: "numeric",
		}) ?? "—"
	);
}

function shortEndpoint(endpoint: string): string {
	return endpoint.replace(/^https?:\/\//, "").replace(/\/wpush\/v2\/.*$/, "…");
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-12">
    <h1
      class="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent mb-8"
    >
      {{ t('account.title') }}
    </h1>

    <!-- Logged out: reader-scoped page, prompt to sign in -->
    <div
      v-if="!isAuthenticated"
      class="text-center py-12 text-gray-500 dark:text-gray-400 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl"
    >
      <p class="mb-3">{{ t('account.signInPrompt') }}</p>
      <NuxtLink
        :to="{ path: '/login', query: { redirect: '/account' } }"
        class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
      >
        <Icon icon="lucide:log-in" class="w-4 h-4" />
        {{ t('account.signInLink') }}
      </NuxtLink>
    </div>

    <div v-else class="space-y-6">
      <!-- Profile -->
      <section class="border border-gray-100 dark:border-gray-700 rounded-xl p-5">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {{ t('account.profile.title') }}
        </h2>
        <!-- A real <form> so Enter in the display-name field saves (was a bare
             div — Enter did nothing and the form relied on mouse-only buttons). -->
        <form class="flex flex-col gap-4" @submit.prevent="saveProfileName">
          <label class="flex flex-col gap-1.5 text-sm">
            <span class="text-gray-600 dark:text-gray-400">{{ t('account.profile.displayNameLabel') }}</span>
            <input
              v-model="displayName"
              type="text"
              maxlength="50"
              class="max-w-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <span class="text-xs text-gray-400">{{ t('account.profile.emailNote') }}{{ reader?.email }}</span>
          <div class="flex items-center gap-3">
            <button
              type="submit"
              :disabled="savingProfile"
              class="px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {{ t('account.profile.save') }}
            </button>
            <span v-if="profileSaved" class="text-sm text-emerald-600 dark:text-emerald-400">
              {{ t('account.profile.saved') }}
            </span>
            <span v-if="profileFailed" class="text-sm text-red-500 dark:text-red-400">
              {{ t('account.profile.saveFailed') }}
            </span>
          </div>
        </form>
      </section>

      <!-- Password -->
      <section class="border border-gray-100 dark:border-gray-700 rounded-xl p-5">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {{ t('account.password.title') }}
        </h2>
        <form class="flex flex-col gap-4 max-w-sm" @submit.prevent="submitPassword">
          <label class="flex flex-col gap-1.5 text-sm">
            <span class="text-gray-600 dark:text-gray-400">{{ t('account.password.currentLabel') }}</span>
            <input
              v-model="pw.current"
              type="password"
              autocomplete="current-password"
              class="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label class="flex flex-col gap-1.5 text-sm">
            <span class="text-gray-600 dark:text-gray-400">{{ t('account.password.newLabel') }}</span>
            <input
              v-model="pw.next"
              type="password"
              autocomplete="new-password"
              maxlength="72"
              class="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label class="flex flex-col gap-1.5 text-sm">
            <span class="text-gray-600 dark:text-gray-400">{{ t('account.password.confirmLabel') }}</span>
            <input
              v-model="pw.confirm"
              type="password"
              autocomplete="new-password"
              class="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <div class="flex items-center gap-3">
            <button
              type="submit"
              :disabled="passwordState === 'busy'"
              class="px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {{ t('account.password.change') }}
            </button>
            <span v-if="passwordState === 'success'" class="text-sm text-emerald-600 dark:text-emerald-400">
              {{ t('account.password.success') }}
            </span>
          </div>
          <p
            v-if="passwordState === 'wrong'"
            class="text-sm text-red-500 dark:text-red-400"
          >{{ t('account.password.wrongCurrent') }}</p>
          <p
            v-if="passwordState === 'mismatch'"
            class="text-sm text-red-500 dark:text-red-400"
          >{{ t('account.password.mismatch') }}</p>
          <p
            v-if="passwordState === 'short'"
            class="text-sm text-red-500 dark:text-red-400"
          >{{ t('account.password.tooShort') }}</p>
          <p
            v-if="passwordState === 'failed'"
            class="text-sm text-red-500 dark:text-red-400"
          >{{ t('account.password.failed') }}</p>
        </form>
      </section>

      <!-- Push devices -->
      <section class="border border-gray-100 dark:border-gray-700 rounded-xl p-5">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
          {{ t('account.devices.title') }}
        </h2>
        <p class="text-xs text-gray-400 mb-4">{{ t('account.devices.note') }}</p>

        <p
          v-if="!devicesLoaded"
          class="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500"
        >
          <Icon icon="lucide:loader-2" class="w-4 h-4 animate-spin" aria-hidden="true" role="presentation" />
          {{ t('account.loading') }}
        </p>
        <div v-else-if="devicesLoadFailed" class="flex items-center gap-3 text-sm text-red-500 dark:text-red-400">
          {{ t('account.loadFailed') }}
          <button
            type="button"
            class="px-2 py-0.5 rounded border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
            @click="loadDevices"
          >
            {{ t('account.retry') }}
          </button>
        </div>
        <p v-else-if="devices.length === 0" class="text-sm text-gray-500 dark:text-gray-400">
          {{ t('account.devices.empty') }}
        </p>
        <ul v-else class="space-y-3">
          <li
            v-for="device in devices"
            :key="device.id"
            class="border border-gray-100 dark:border-gray-800 rounded-lg p-3"
          >
            <div class="flex items-center justify-between gap-3 text-sm">
              <div class="min-w-0">
                <p class="truncate text-gray-900 dark:text-gray-100">{{ shortEndpoint(device.endpoint) }}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400">{{ formatDate(device.created_at) }}</p>
              </div>
              <button
                type="button"
                :disabled="revokingId === device.id"
                class="shrink-0 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                @click="revokeDevice(device)"
              >
                <Icon icon="lucide:trash-2" class="w-3.5 h-3.5" />
                {{ t('account.devices.revoke') }}
              </button>
            </div>

            <!-- New-post notification prefs (DEC-076, TASK-147) -->
            <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <label class="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  :checked="device.want_new_posts"
                  :disabled="savingPrefsId === device.id"
                  @change="onDeviceNewPostsChange(device, $event)"
                />
                <span class="text-gray-700 dark:text-gray-300">
                  {{ t('account.devices.newPosts') }}
                </span>
              </label>
              <label
                v-if="device.want_new_posts"
                class="inline-flex items-center gap-2"
              >
                <span class="text-xs text-gray-500 dark:text-gray-400">
                  {{ t('account.devices.followCategory') }}
                </span>
                <select
                  class="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  :value="device.new_post_category_id ?? ''"
                  :disabled="savingPrefsId === device.id"
                  @change="onDeviceCategoryChange(device, $event)"
                >
                  <option value="">{{ t('account.devices.allNewPosts') }}</option>
                  <option v-for="cat in categories" :key="cat.id" :value="String(cat.id)">
                    {{ cat.name }}
                  </option>
                </select>
              </label>
              <span
                v-if="savingPrefsId === device.id"
                class="text-xs text-gray-400 animate-pulse"
              >…</span>
            </div>
          </li>
        </ul>
        <p v-if="deviceError" class="mt-2 text-sm text-red-500 dark:text-red-400">
          {{ t('account.devices.revokeFailed') }}
        </p>
        <p v-if="prefsError" class="mt-2 text-sm text-red-500 dark:text-red-400">
          {{ t('account.devices.prefsFailed') }}
        </p>
      </section>

      <!-- Followed discussions (DEC-078, TASK-150) -->
      <section class="border border-gray-100 dark:border-gray-700 rounded-xl p-5">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
          {{ t('account.threads.title') }}
        </h2>
        <p class="text-xs text-gray-400 mb-4">{{ t('account.threads.note') }}</p>

        <p
          v-if="!threadsLoaded"
          class="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500"
        >
          <Icon icon="lucide:loader-2" class="w-4 h-4 animate-spin" aria-hidden="true" role="presentation" />
          {{ t('account.loading') }}
        </p>
        <div v-else-if="threadsLoadFailed" class="flex items-center gap-3 text-sm text-red-500 dark:text-red-400">
          {{ t('account.loadFailed') }}
          <button
            type="button"
            class="px-2 py-0.5 rounded border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
            @click="loadThreads"
          >
            {{ t('account.retry') }}
          </button>
        </div>
        <p v-else-if="threads.length === 0" class="text-sm text-gray-500 dark:text-gray-400">
          {{ t('account.threads.empty') }}
        </p>
        <ul v-else class="space-y-3">
          <li
            v-for="thread in threads"
            :key="thread.id"
            class="border border-gray-100 dark:border-gray-800 rounded-lg p-3"
          >
            <div class="flex items-center justify-between gap-3 text-sm">
              <NuxtLink
                :to="`/posts/${thread.slug}`"
                class="min-w-0 truncate text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                {{ thread.title }}
              </NuxtLink>
              <button
                type="button"
                :disabled="unsubscribingId === thread.id"
                class="shrink-0 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                @click="unfollowThread(thread)"
              >
                <Icon icon="lucide:bell-off" class="w-3.5 h-3.5" />
                {{ t('account.threads.unfollow') }}
              </button>
            </div>
          </li>
        </ul>
        <p v-if="threadsError" class="mt-2 text-sm text-red-500 dark:text-red-400">
          {{ t('account.threads.failed') }}
        </p>
      </section>

      <!-- Followed series for new-part push (DEC-134, TASK-179) -->
      <section class="border border-gray-100 dark:border-gray-700 rounded-xl p-5">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
          {{ t('account.series.title') }}
        </h2>
        <p class="text-xs text-gray-400 mb-4">{{ t('account.series.note') }}</p>

        <p
          v-if="!seriesFollowsLoaded"
          class="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500"
        >
          <Icon icon="lucide:loader-2" class="w-4 h-4 animate-spin" aria-hidden="true" role="presentation" />
          {{ t('account.loading') }}
        </p>
        <div v-else-if="seriesFollowsLoadFailed" class="flex items-center gap-3 text-sm text-red-500 dark:text-red-400">
          {{ t('account.loadFailed') }}
          <button
            type="button"
            class="px-2 py-0.5 rounded border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
            @click="loadSeriesFollows"
          >
            {{ t('account.retry') }}
          </button>
        </div>
        <p v-else-if="seriesFollows.length === 0" class="text-sm text-gray-500 dark:text-gray-400">
          {{ t('account.series.empty') }}
        </p>
        <ul v-else class="space-y-3">
          <li
            v-for="sf in seriesFollows"
            :key="sf.id"
            class="border border-gray-100 dark:border-gray-800 rounded-lg p-3"
          >
            <div class="flex items-center justify-between gap-3 text-sm">
              <NuxtLink
                :to="`/series/${sf.slug}`"
                class="min-w-0 truncate text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                {{ sf.title }}
              </NuxtLink>
              <div class="shrink-0 flex items-center gap-3">
                <button
                  type="button"
                  :disabled="seriesNotifyId === sf.id"
                  :title="t('account.series.notifyTitle')"
                  class="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-indigo-600 transition-colors disabled:opacity-50"
                  @click="toggleSeriesNotify(sf)"
                >
                  <Icon :icon="sf.notify ? 'lucide:bell' : 'lucide:bell-off'" class="w-3.5 h-3.5" />
                  {{ t(sf.notify ? 'account.series.notifyOn' : 'account.series.notifyOff') }}
                </button>
                <button
                  type="button"
                  :disabled="seriesUnfollowId === sf.id"
                  class="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                  @click="unfollowFollowedSeries(sf)"
                >
                  <Icon icon="lucide:x" class="w-3.5 h-3.5" />
                  {{ t('account.series.unfollow') }}
                </button>
              </div>
            </div>
          </li>
        </ul>
        <p v-if="seriesFollowsError" class="mt-2 text-sm text-red-500 dark:text-red-400">
          {{ t('account.series.failed') }}
        </p>
      </section>

      <!-- Followed categories for new-post push (DEC-140, TASK-182) -->
      <section class="border border-gray-100 dark:border-gray-700 rounded-xl p-5">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
          {{ t('account.categories.title') }}
        </h2>
        <p class="text-xs text-gray-400 mb-4">{{ t('account.categories.note') }}</p>

        <p
          v-if="!categoryFollowsLoaded"
          class="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500"
        >
          <Icon icon="lucide:loader-2" class="w-4 h-4 animate-spin" aria-hidden="true" role="presentation" />
          {{ t('account.loading') }}
        </p>
        <div v-else-if="categoryFollowsLoadFailed" class="flex items-center gap-3 text-sm text-red-500 dark:text-red-400">
          {{ t('account.loadFailed') }}
          <button
            type="button"
            class="px-2 py-0.5 rounded border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
            @click="loadCategoryFollows"
          >
            {{ t('account.retry') }}
          </button>
        </div>
        <p v-else-if="categoryFollows.length === 0" class="text-sm text-gray-500 dark:text-gray-400">
          {{ t('account.categories.empty') }}
        </p>
        <ul v-else class="space-y-3">
          <li
            v-for="cf in categoryFollows"
            :key="cf.id"
            class="border border-gray-100 dark:border-gray-800 rounded-lg p-3"
          >
            <div class="flex items-center justify-between gap-3 text-sm">
              <NuxtLink
                :to="{ path: '/', query: { category_id: String(cf.id) } }"
                class="min-w-0 truncate text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                {{ cf.name }}
              </NuxtLink>
              <div class="shrink-0 flex items-center gap-3">
                <button
                  type="button"
                  :disabled="categoryNotifyId === cf.id"
                  :title="t('account.categories.notifyTitle')"
                  class="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-emerald-600 transition-colors disabled:opacity-50"
                  @click="toggleCategoryNotify(cf)"
                >
                  <Icon :icon="cf.notify ? 'lucide:bell' : 'lucide:bell-off'" class="w-3.5 h-3.5" />
                  {{ t(cf.notify ? 'account.categories.notifyOn' : 'account.categories.notifyOff') }}
                </button>
                <button
                  type="button"
                  :disabled="categoryUnfollowId === cf.id"
                  class="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                  @click="unfollowFollowedCategory(cf)"
                >
                  <Icon icon="lucide:x" class="w-3.5 h-3.5" />
                  {{ t('account.categories.unfollow') }}
                </button>
              </div>
            </div>
          </li>
        </ul>
        <p v-if="categoryFollowsError" class="mt-2 text-sm text-red-500 dark:text-red-400">
          {{ t('account.categories.failed') }}
        </p>
      </section>

      <!-- Followed tags for new-post push (DEC-195, TASK-215) -->
      <section class="border border-gray-100 dark:border-gray-700 rounded-xl p-5">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
          {{ t('account.tags.title') }}
        </h2>
        <p class="text-xs text-gray-400 mb-4">{{ t('account.tags.note') }}</p>

        <p
          v-if="!tagFollowsLoaded"
          class="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500"
        >
          <Icon icon="lucide:loader-2" class="w-4 h-4 animate-spin" aria-hidden="true" role="presentation" />
          {{ t('account.loading') }}
        </p>
        <div v-else-if="tagFollowsLoadFailed" class="flex items-center gap-3 text-sm text-red-500 dark:text-red-400">
          {{ t('account.loadFailed') }}
          <button
            type="button"
            class="px-2 py-0.5 rounded border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
            @click="loadTagFollows"
          >
            {{ t('account.retry') }}
          </button>
        </div>
        <p v-else-if="tagFollows.length === 0" class="text-sm text-gray-500 dark:text-gray-400">
          {{ t('account.tags.empty') }}
        </p>
        <ul v-else class="space-y-3">
          <li
            v-for="tf in tagFollows"
            :key="tf.id"
            class="border border-gray-100 dark:border-gray-800 rounded-lg p-3"
          >
            <div class="flex items-center justify-between gap-3 text-sm">
              <NuxtLink
                :to="{ path: '/tags', query: { tag_id: String(tf.id) } }"
                class="min-w-0 truncate text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                #{{ tf.name }}
              </NuxtLink>
              <div class="shrink-0 flex items-center gap-3">
                <button
                  type="button"
                  :disabled="tagNotifyId === tf.id"
                  :title="t('account.tags.notifyTitle')"
                  class="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-emerald-600 transition-colors disabled:opacity-50"
                  @click="toggleTagNotify(tf)"
                >
                  <Icon :icon="tf.notify ? 'lucide:bell' : 'lucide:bell-off'" class="w-3.5 h-3.5" />
                  {{ t(tf.notify ? 'account.tags.notifyOn' : 'account.tags.notifyOff') }}
                </button>
                <button
                  type="button"
                  :disabled="tagUnfollowId === tf.id"
                  class="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                  @click="unfollowFollowedTag(tf)"
                >
                  <Icon icon="lucide:x" class="w-3.5 h-3.5" />
                  {{ t('account.tags.unfollow') }}
                </button>
              </div>
            </div>
          </li>
        </ul>
        <p v-if="tagFollowsError" class="mt-2 text-sm text-red-500 dark:text-red-400">
          {{ t('account.tags.failed') }}
        </p>
      </section>

      <!-- Data export (DEC-126, TASK-175): portable copy of the reader's data -->
      <section class="border border-gray-100 dark:border-gray-700 rounded-xl p-5">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
          {{ t('account.export.title') }}
        </h2>
        <p class="text-xs text-gray-400 mb-4">{{ t('account.export.description') }}</p>
        <button
          type="button"
          :disabled="exportingData"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          @click="downloadMyData"
        >
          <Icon :icon="exportingData ? 'lucide:loader-2' : 'lucide:download'" class="w-4 h-4" :class="{ 'animate-spin': exportingData }" />
          {{ t('account.export.download') }}
        </button>
        <p
          v-if="exportState === 'done'"
          class="mt-2 text-sm text-emerald-600 dark:text-emerald-400"
        >{{ t('account.export.done') }}</p>
        <p
          v-else-if="exportState === 'failed'"
          class="mt-2 text-sm text-red-500 dark:text-red-400"
        >{{ t('account.export.failed') }}</p>
      </section>

      <!-- Delete account (DEC-106, TASK-165): self-service account deletion -->
      <section class="border border-red-200 dark:border-red-900/50 rounded-xl p-5">
        <h2 class="text-lg font-semibold text-red-600 dark:text-red-400 mb-1">
          {{ t('account.deleteAccount.title') }}
        </h2>
        <p class="text-xs text-gray-400 mb-4">{{ t('account.deleteAccount.description') }}</p>

        <form class="flex flex-col sm:flex-row sm:items-end gap-3" @submit.prevent="deleteAccount">
          <label class="flex-1 min-w-0">
            <span class="text-sm text-gray-600 dark:text-gray-400">{{ t('account.deleteAccount.passwordLabel') }}</span>
            <input
              v-model="deletePassword"
              type="password"
              autocomplete="current-password"
              class="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </label>
          <button
            type="submit"
            :disabled="deletingAccount || !deletePassword"
            class="shrink-0 px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {{ t('account.deleteAccount.delete') }}
          </button>
        </form>
        <p
          v-if="deleteError?.code === 'wrong'"
          class="mt-2 text-sm text-red-500 dark:text-red-400"
        >{{ t('account.deleteAccount.wrongPassword') }}</p>
        <p
          v-else-if="deleteError?.code === 'failed'"
          class="mt-2 text-sm text-red-500 dark:text-red-400"
        >{{ t('account.deleteAccount.failed') }}</p>
      </section>
    </div>
  </div>
</template>
