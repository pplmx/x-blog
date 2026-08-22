<script setup lang="ts">
/**
 * Reader account settings (DEC-067, TASK-142): edit display name, rotate the
 * password (verifying the current one; the fresh token keeps this session
 * alive while the version bump signs other sessions out), and see/revoke the
 * browser push devices bound to the account.
 */
import {
	type Category,
	changeMyPassword,
	deleteReaderAccount,
	fetchCategories,
	fetchMyPostSubscriptions,
	fetchMyPushSubscriptions,
	type ReaderPushSubscription,
	revokeMyPushSubscription,
	type SubscribedThreadItem,
	unsubscribeFromPostThread,
	updateMyProfile,
	updateMyPushSubscriptionPrefs,
} from "~~/composables/useApi";
import { useReaderAuth } from "~~/composables/useReaderAuth";
import { useSeo } from "~~/composables/useSeo";

const { t, locale } = useLang();
const { isAuthenticated, reader, setProfile, updateToken, logout } = useReaderAuth();

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
	savingProfile.value = true;
	profileSaved.value = false;
	profileFailed.value = false;
	const name = displayName.value.trim();
	if (!name) return;
	try {
		const updated = await updateMyProfile({ display_name: name });
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
		const session = await changeMyPassword({
			current_password: pw.value.current,
			new_password: next,
		});
		// The version bump invalidates the stored token — persist the fresh one
		// so this session stays signed in while other devices are signed out.
		updateToken(session);
		pw.value = { current: "", next: "", confirm: "" };
		passwordState.value = "success";
	} catch (err) {
		const status = (err as { status?: number })?.status;
		passwordState.value = status === 401 ? "wrong" : "failed";
	}
}

/* Push devices ---------------------------------------------------------- */
const devices = ref<ReaderPushSubscription[]>([]);
const devicesLoaded = ref(false);
const revokingId = ref<number | null>(null);
const deviceError = ref(false);

async function loadDevices() {
	if (!isAuthenticated.value) return;
	try {
		const data = await fetchMyPushSubscriptions();
		devices.value = data.items;
	} catch {
		devices.value = [];
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
// synchronous and tests can mock fetchCategories like any useApi helper.
async function loadCategories() {
	try {
		categories.value = await fetchCategories();
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
const unsubscribingId = ref<number | null>(null);
const threadsError = ref(false);

async function loadThreads() {
	if (!isAuthenticated.value) return;
	try {
		const data = await fetchMyPostSubscriptions();
		threads.value = data.items;
	} catch {
		threads.value = [];
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

/* Delete account (DEC-106, TASK-165) ---------------------------------- */
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
		const status = (e as { status?: number }).status;
		deleteError.value = { code: status === 401 ? "wrong" : "failed" };
	} finally {
		deletingAccount.value = false;
	}
}

onMounted(() => {
	loadDevices();
	loadCategories();
	loadThreads();
	// Keep the name input in sync if the header "reader" profile loads after us.
	displayName.value = reader.value?.display_name ?? displayName.value;
});

function formatDate(dateStr: string | null): string {
	if (!dateStr) return "—";
	return new Date(dateStr).toLocaleDateString(locale.value === "zh" ? "zh-CN" : "en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
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
        to="/login"
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
        <div class="flex flex-col gap-4">
          <label class="flex flex-col gap-1.5 text-sm">
            <span class="text-gray-600 dark:text-gray-400">{{ t('account.profile.displayNameLabel') }}</span>
            <input
              v-model="displayName"
              type="text"
              maxlength="50"
              class="max-w-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <span class="text-xs text-gray-400">{{ t('account.profile.emailNote') }}：{{ reader?.email }}</span>
          <div class="flex items-center gap-3">
            <button
              type="button"
              :disabled="savingProfile"
              class="px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50"
              @click="saveProfileName"
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
        </div>
      </section>

      <!-- Password -->
      <section class="border border-gray-100 dark:border-gray-700 rounded-xl p-5">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {{ t('account.password.title') }}
        </h2>
        <div class="flex flex-col gap-4 max-w-sm">
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
              type="button"
              :disabled="passwordState === 'busy'"
              class="px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50"
              @click="submitPassword"
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
        </div>
      </section>

      <!-- Push devices -->
      <section class="border border-gray-100 dark:border-gray-700 rounded-xl p-5">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
          {{ t('account.devices.title') }}
        </h2>
        <p class="text-xs text-gray-400 mb-4">{{ t('account.devices.note') }}</p>

        <p v-if="devicesLoaded && devices.length === 0" class="text-sm text-gray-500 dark:text-gray-400">
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

        <p v-if="threadsLoaded && threads.length === 0" class="text-sm text-gray-500 dark:text-gray-400">
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

      <!-- Delete account (DEC-106, TASK-165): self-service account deletion -->
      <section class="border border-red-200 dark:border-red-900/50 rounded-xl p-5">
        <h2 class="text-lg font-semibold text-red-600 dark:text-red-400 mb-1">
          {{ t('account.deleteAccount.title') }}
        </h2>
        <p class="text-xs text-gray-400 mb-4">{{ t('account.deleteAccount.description') }}</p>

        <div class="flex flex-col sm:flex-row sm:items-end gap-3">
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
            type="button"
            :disabled="deletingAccount || !deletePassword"
            class="shrink-0 px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            @click="deleteAccount"
          >
            {{ t('account.deleteAccount.delete') }}
          </button>
        </div>
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
