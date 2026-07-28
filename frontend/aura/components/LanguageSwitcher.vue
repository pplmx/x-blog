<script setup lang="ts">
import { useI18n } from "../composables/useI18n";

const { locale, switchLocale, localeNames } = useI18n();
</script>

<template>
  <div class="relative inline-block">
    <select
      :value="locale"
      @change="switchLocale(($event.target as HTMLSelectElement).value as 'zh-CN' | 'en' | 'zh-TW')"
      class="appearance-none bg-transparent border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 pr-6 text-sm text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
      aria-label="Switch language"
    >
      <option v-for="loc in Object.keys(localeNames)" :key="loc" :value="loc">
        {{ localeNames[loc as 'zh-CN' | 'en' | 'zh-TW'] }}
      </option>
    </select>
    <Icon
      icon="lucide:chevron-down"
      class="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none"
    />
  </div>
</template>
