<!--
  Admin Settings page (DEC-100, TASK-162).
  Lets the operator flip runtime site settings without a redeploy. The first
  setting surfaced is the verified-reader auto-approve trust tier toggle.
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import { updateSiteSetting, useSiteSetting } from "~~/api/admin/settings";

definePageMeta({ layout: "admin" });

const { t } = useLang();
useHead({ title: computed(() => t("admin.settings.title")) });

const SETTING_KEY = "auto_approve_reader_comments";

const enabled = ref(false);
const loading = ref(true);
const saving = ref(false);
const saved = ref(false);
const error = ref<string | null>(null);

async function load() {
	loading.value = true;
	error.value = null;
	try {
		const { data } = await useSiteSetting(SETTING_KEY);
		const value = data.value?.value;
		enabled.value = value === "true";
	} catch {
		error.value = t("admin.settings.loadFailed");
	} finally {
		loading.value = false;
	}
}

async function save() {
	if (saving.value) return;
	saving.value = true;
	saved.value = false;
	error.value = null;
	try {
		await updateSiteSetting(SETTING_KEY, enabled.value ? "true" : "false");
		saved.value = true;
	} catch {
		error.value = t("admin.settings.saveFailed");
	} finally {
		saving.value = false;
	}
}

await load();
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
      {{ t("admin.settings.title") }}
    </h1>

    <div class="max-w-2xl rounded-lg border border-gray-200 dark:border-gray-700 p-5 bg-white dark:bg-gray-800">
      <div v-if="loading" class="text-sm text-gray-500 dark:text-gray-400">
        {{ t("admin.settings.loading") }}
      </div>

      <template v-else>
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="font-medium text-gray-900 dark:text-gray-100">
              {{ t("admin.settings.autoApproveLabel") }}
            </h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {{ t("admin.settings.autoApproveDescription") }}
            </p>
          </div>
          <label class="inline-flex items-center cursor-pointer">
            <input
              v-model="enabled"
              type="checkbox"
              class="accent-blue-600 w-5 h-5"
              :aria-label="t('admin.settings.autoApproveLabel')"
            />
          </label>
        </div>

        <div class="mt-5">
          <button
            type="button"
            class="px-4 py-2 rounded text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
            :disabled="saving"
            @click="save"
          >
            {{ saving ? t("admin.settings.saving") : t("admin.settings.save") }}
          </button>
          <span v-if="saved" class="ml-3 text-sm text-green-600 dark:text-green-400">
            {{ t("admin.settings.saved") }}
          </span>
          <p v-if="error" class="mt-2 text-sm text-red-500">{{ error }}</p>
        </div>
      </template>
    </div>
  </div>
</template>
