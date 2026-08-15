<script setup lang="ts">
const { locale } = useLang();

// Keep <html lang> in sync with the active locale (reactivity via unhead fn).
useHead({ htmlAttrs: { lang: () => locale.value } });
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
