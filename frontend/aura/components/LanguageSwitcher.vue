<script setup lang="ts">
const { locale, setLocale, locales } = useLang();
</script>

<template>
  <div class="flex items-center gap-1 text-xs font-medium select-none">
    <button
      v-for="l in locales"
      :key="l.code"
      type="button"
      :aria-label="l.native"
      :class="[
        'px-1.5 py-0.5 rounded transition-colors',
        locale === l.code
          ? 'text-blue-600 dark:text-blue-400 font-semibold'
          : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200',
      ]"
      @click="setLocale(l.code)"
    >
      {{ l.native }}
    </button>
  </div>
</template>
