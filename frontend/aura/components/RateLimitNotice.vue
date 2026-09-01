<script setup lang="ts">
/**
 * App-wide rate-limit notice (round 211, DEC-216 theme: 使用性/易用性).
 *
 * Renders when any API call in the app receives HTTP 429 (see
 * api/transport.ts flagRateLimit). Reads the reactive flag from the shared
 * useRateLimitNotice singleton, translates the message here (component
 * context — safe i18n), and auto-dismisses after a few seconds.
 */
import { useRateLimitNotice } from "~~/composables/useRateLimitNotice";

const { t } = useLang();
const { active, dismiss } = useRateLimitNotice();
</script>

<template>
  <Teleport to="body">
    <div
      v-if="active"
      aria-live="polite"
      class="fixed bottom-4 right-4 z-[100] flex max-w-sm items-start gap-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-white dark:bg-gray-900 p-4 shadow-lg"
    >
      <Icon icon="lucide:clock" class="mt-0.5 w-5 h-5 shrink-0 text-amber-500" aria-hidden="true" role="presentation" />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
          {{ t('common.errors.rateLimit') }}
        </p>
        <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {{ t('common.errors.rateLimitHint') }}
        </p>
      </div>
      <button
        type="button"
        :aria-label="t('common.action.close')"
        class="shrink-0 p-1 -m-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
        @click="dismiss"
      >
        <Icon icon="lucide:x" class="w-4 h-4" aria-hidden="true" role="presentation" />
      </button>
    </div>
  </Teleport>
</template>
