<script setup lang="ts">
import { useSeo } from "~~/composables/useSeo";

const { t } = useLang();

// SEO: set dynamic head metadata. Getter form so an in-app language switch
// re-evaluates title/og tags instead of freezing the initial language
// (same reason every reader page passes a getter, ISS-372).
useSeo(() => ({
	title: t("about.seo.title"),
	description: t("about.seo.description"),
	path: "/about",
}));

const techStack = [
	{
		icon: "lucide:globe",
		name: "Nuxt",
		descKey: "about.techStack.desc.frontend",
		color: "from-black to-gray-800",
	},
	{
		icon: "lucide:code-2",
		name: "FastAPI",
		descKey: "about.techStack.desc.backend",
		color: "from-green-500 to-green-700",
	},
	{
		icon: "lucide:database",
		name: "SQLAlchemy",
		descKey: "about.techStack.desc.orm",
		color: "from-orange-500 to-red-500",
	},
	{
		icon: "lucide:sparkles",
		name: "TypeScript",
		descKey: "about.techStack.desc.language",
		color: "from-blue-500 to-blue-700",
	},
];

const features = [
	"about.features.markdown",
	"about.features.categories",
	"about.features.comments",
	"about.features.views",
	"about.features.rss",
	"about.features.seo",
	"about.features.responsive",
	"about.features.admin",
];
</script>

<template>
  <div class="max-w-4xl mx-auto">
    <NuxtLink
      to="/"
      class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-600 transition-colors mb-8"
    >
      <Icon icon="lucide:arrow-left" class="w-4 h-4" />
      {{ t("common.action.backHome") }}
    </NuxtLink>

    <div class="text-center mb-12">
      <div
        class="inline-flex items-center justify-center w-24 h-24 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-3xl shadow-xl shadow-blue-600/25 mb-6"
      >
        <Icon icon="lucide:sparkles" class="w-12 h-12 text-white" />
      </div>
      <h1
        class="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent mb-3"
      >
        {{ t("about.seo.title") }}
      </h1>
      <p class="text-gray-500 dark:text-gray-400">{{ t("about.tagline") }}</p>
    </div>

    <div
      class="bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 rounded-2xl p-6 sm:p-8 mb-8 border border-gray-100 dark:border-gray-800"
    >
      <p class="text-gray-600 dark:text-gray-300 leading-relaxed mb-4">
        {{ t("about.intro1") }}
      </p>
      <p class="text-gray-600 dark:text-gray-300 leading-relaxed">
        {{ t("about.intro2") }}
      </p>
    </div>

    <div class="mb-8">
      <h2 class="text-lg font-bold mb-4 flex items-center gap-2 text-gray-900 dark:text-gray-100">
        <Icon icon="lucide:code-2" class="w-5 h-5 text-blue-600" />
        {{ t("about.techStack.title") }}
      </h2>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div
          v-for="tech in techStack"
          :key="tech.name"
          class="bg-white dark:bg-gray-900 rounded-xl p-4 text-center border border-gray-100 dark:border-gray-800 hover:shadow-lg hover:border-gray-200 dark:hover:border-gray-700 transition-all duration-200"
        >
          <div
            :class="`inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br ${tech.color} mb-3 shadow-md`"
          >
            <Icon :icon="tech.icon" class="w-6 h-6 text-white" />
          </div>
          <p class="font-semibold text-gray-900 dark:text-gray-100">{{ tech.name }}</p>
          <p class="text-xs text-gray-500 dark:text-gray-400">{{ t(tech.descKey) }}</p>
        </div>
      </div>
    </div>

    <div class="mb-8">
      <h2 class="text-lg font-bold mb-4 text-gray-900 dark:text-gray-100">{{ t("about.featuresTitle") }}</h2>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div
          v-for="feature in features"
          :key="feature"
          class="bg-gradient-to-r from-blue-50 dark:from-blue-900/30 to-indigo-50 dark:to-indigo-900/30 border border-blue-100 dark:border-blue-900/50 rounded-xl px-4 py-3 text-sm text-blue-700 dark:text-blue-300 font-medium text-center hover:shadow-md transition-shadow"
        >
          {{ t(feature) }}
        </div>
      </div>
    </div>

    <div class="text-center pt-8 border-t border-gray-100 dark:border-gray-800">
      <p class="text-gray-500 dark:text-gray-400 text-sm flex items-center justify-center gap-2">
        {{ t("common.footer.madeWith") }} <Icon icon="lucide:heart" class="w-4 h-4 text-red-500 animate-pulse" /> {{ t("common.footer.forDevelopers") }}
      </p>
    </div>
  </div>
</template>
