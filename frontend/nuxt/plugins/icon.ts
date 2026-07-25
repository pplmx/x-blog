import { defineNuxtPlugin } from "#app";
import { Icon } from "@iconify/vue";

/**
 * Register the Icon component globally so <Icon icon="lucide:..." /> works
 * in all Vue/Nuxt SFCs without per-file imports.
 *
 * Migration note: replaces the deprecated `lucide-vue` package, which had
 * a runtime bug (createLucideIcon: Cannot read 'color' of undefined) when
 * used with <component :is="..."> dynamic components.
 */
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.component("Icon", Icon);
});
