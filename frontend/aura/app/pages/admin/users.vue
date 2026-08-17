<!--
  Admin Users Page — list, create and delete admin accounts.
  Backs onto the existing /api/admin/users API (TASK-076, ISS-045).
-->
<script setup lang="ts">
import { createAdminUser, deleteAdminUser, fetchAdminUsers } from "~~/composables/useApi";

definePageMeta({ layout: "admin" });

const { t } = useLang();

useHead({ title: computed(() => t("admin.users.seoTitle")) });

// The admin users page is superuser-only (backend: get_current_superuser).
// Hide its entire content for editors even on direct navigation (not just the
// hidden sidebar link) so an editor never sees the provisioning form. The API
// independently enforces a 403 on every /users call. (DEC-054, TASK-116)
const storedRole =
	typeof window !== "undefined" && typeof localStorage?.getItem === "function"
		? localStorage.getItem("admin_role")
		: null;
const isSuperuserView = ref(storedRole !== "editor");

const { data: users, pending, error, refresh } = await fetchAdminUsers();

// The backend rejects self-deletion by user id (admin.py delete_user compares
// user_id == _current_user.id), so mirror that here: decode the JWT `sub`
// claim client-side and disable the delete action on the current account.
// Signature is not verified client-side — the backend enforces the real check;
// this is purely a UI affordance.
const currentUserId = ref<number | null>(null);
function decodeJwtSub(token: string): number | null {
	try {
		const payload = token.split(".")[1];
		if (!payload) return null;
		const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
		const sub = decoded?.sub;
		return sub != null ? Number.parseInt(String(sub), 10) : null;
	} catch {
		return null;
	}
}
if (typeof window !== "undefined" && typeof localStorage?.getItem === "function") {
	const token = localStorage.getItem("admin_token");
	if (token) currentUserId.value = decodeJwtSub(token);
}
const newUsername = ref("");
const newPassword = ref("");
const confirmPassword = ref("");
const isProcessing = ref(false);
const actionError = ref<string | null>(null);
const actionSuccess = ref<string | null>(null);

function getErrorMessage(e: unknown): string {
	if (e instanceof Error) return e.message;
	return t("admin.users.operationFailed");
}

async function handleCreate() {
	const username = newUsername.value.trim();
	if (!username || newPassword.value.length < 8) {
		actionError.value = t("admin.users.validation");
		return;
	}
	if (newPassword.value !== confirmPassword.value) {
		actionError.value = t("admin.users.passwordMismatch");
		return;
	}
	isProcessing.value = true;
	actionError.value = null;
	actionSuccess.value = null;
	try {
		await createAdminUser({ username, password: newPassword.value });
		newUsername.value = "";
		newPassword.value = "";
		confirmPassword.value = "";
		actionSuccess.value = t("admin.users.created");
		await refresh();
	} catch (e) {
		actionError.value = getErrorMessage(e);
	} finally {
		isProcessing.value = false;
	}
}

async function handleDelete(id: number) {
	if (id === currentUserId.value) {
		actionError.value = t("admin.users.cannotDeleteSelf");
		return;
	}
	if (!confirm(t("admin.users.confirmDelete"))) return;
	isProcessing.value = true;
	actionError.value = null;
	actionSuccess.value = null;
	try {
		await deleteAdminUser(id);
		actionSuccess.value = t("admin.users.deleted");
		await refresh();
	} catch (e) {
		actionError.value = getErrorMessage(e);
	} finally {
		isProcessing.value = false;
	}
}
</script>

<template>
  <div>
    <div v-if="!isSuperuserView" class="text-center py-16">
      <Icon icon="lucide:lock" class="w-12 h-12 text-gray-400 mb-4 mx-auto" />
      <h2 class="text-lg font-medium text-gray-700 dark:text-gray-300 mb-1">
        {{ t("admin.users.accessDenied") }}
      </h2>
      <p class="text-sm text-gray-500 dark:text-gray-400">
        {{ t("admin.users.editorNoAccess") }}
      </p>
    </div>

    <template v-if="isSuperuserView">
    <div class="mb-8">
      <h1
        class="text-2xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent"
      >
        {{ t("admin.users.title") }}
      </h1>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
        {{ t("admin.users.summary", { n: users?.length || 0 }) }}
      </p>
    </div>

    <!-- Feedback -->
    <div
      v-if="actionError"
      class="mb-6 px-4 py-3 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-600 dark:text-red-400"
    >
      {{ actionError }}
    </div>
    <div
      v-if="actionSuccess"
      class="mb-6 px-4 py-3 rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 text-sm text-green-600 dark:text-green-400"
    >
      {{ actionSuccess }}
    </div>

    <!-- Create form -->
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-6 mb-6">
      <h2 class="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
        {{ t("admin.users.createTitle") }}
      </h2>
      <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="handleCreate">
        <input
          v-model="newUsername"
          type="text"
          autocomplete="off"
          :placeholder="t('admin.users.usernamePlaceholder')"
          class="px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
        >
        <input
          v-model="newPassword"
          type="password"
          autocomplete="new-password"
          :placeholder="t('admin.users.passwordPlaceholder')"
          class="px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
        >
        <input
          v-model="confirmPassword"
          type="password"
          autocomplete="new-password"
          :placeholder="t('admin.users.confirmPasswordPlaceholder')"
          class="px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
        >
        <button
          type="submit"
          :disabled="isProcessing"
          class="px-6 py-3 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors"
        >
          {{ t("admin.users.create") }}
        </button>
      </form>
      <p class="text-xs text-gray-400 dark:text-gray-500 mt-3">
        {{ t("admin.users.hint") }}
      </p>
    </div>

    <!-- Users list -->
    <div v-if="pending" class="text-center py-12">
      <Icon icon="lucide:loader-2" class="w-5 h-5 animate-spin inline-block mr-2" />
      {{ t("admin.users.loading") }}
    </div>

    <div v-else-if="error" class="text-center py-12 text-red-500">
      {{ error?.message || String(error) }}
    </div>

    <div
      v-else-if="!users || users.length === 0"
      class="text-center py-16 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800"
    >
      <Icon icon="lucide:users" class="w-12 h-12 text-gray-400 mb-4 mx-auto" />
      <p class="text-gray-500 dark:text-gray-400">
        {{ t("admin.users.empty") }}
      </p>
    </div>

    <div v-else class="space-y-3">
      <div
        v-for="user in users"
        :key="user.id"
        class="flex items-center justify-between p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800"
      >
        <div class="flex items-center gap-3">
          <Icon icon="lucide:user" class="w-5 h-5 text-gray-400" />
          <div>
            <span class="text-gray-900 dark:text-gray-100 font-medium inline-flex items-center gap-2">
              {{ user.username }}
              <span
                v-if="user.role === 'superuser' || user.is_superuser"
                class="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400"
              >
                {{ t("admin.users.superuser") }}
              </span>
              <span
                v-else
                class="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400"
              >
                {{ t("admin.users.editor") }}
              </span>
            </span>
          </div>
        </div>

        <button
          type="button"
          :disabled="isProcessing || user.id === currentUserId"
          class="px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          @click="handleDelete(user.id)"
        >
          {{ t("admin.users.delete") }}
        </button>
      </div>
    </div>
    </template>
  </div>
</template>
