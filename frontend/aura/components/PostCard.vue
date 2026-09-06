<script setup lang="ts">
import type { PostList } from "~~/api/contracts/shared";
import { effectivePublishTs, parseApiDate } from "~~/composables/apiDate";
import { coverImageSrc } from "~~/composables/useCoverImage";

interface Props {
	post: PostList;
}

const props = withDefaults(defineProps<Props>(), {});
const { post } = toRefs(props);

const { locale, t } = useLang();

const coverImageUrl = computed(() => coverImageSrc(post.value.title));

// A card dates a post by when it went live (publish_at ?? created_at): the
// feed now orders by effective publish time, so a scheduled post must show
// the date readers actually got it, not the month it was drafted (RIL ISS-265).
const date = computed(
	() =>
		parseApiDate(effectivePublishTs(props.post))?.toLocaleDateString(
			locale.value === "zh" ? "zh-CN" : "en-US",
			{
				year: "numeric",
				month: "long",
				day: "numeric",
			},
		) ?? "",
);
</script>

<template>
  <article class="group border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden hover:border-gray-200 dark:hover:border-gray-700 hover:shadow-xl hover:shadow-gray-100/50 dark:hover:shadow-gray-900/50 transition-all duration-300 bg-white dark:bg-gray-900 relative">
    <div class="absolute top-3 right-3 z-10">
      <BookmarkButton
        :post-id="post.id"
        :post="post"
        variant="icon"
      />
    </div>
    <NuxtLink :to="`/posts/${post.slug}`" :title="post.title">
      <!-- Cover image. The algorithmic gradient SVG literally renders the
           title inside the artwork, and the <h2> below announces the same
           title — :alt="post.title" read it a third time per card. The image
           is decorative next to its adjacent title, so alt="" (WCAG — the
           card's accessible name comes from the real heading text). -->
      <div class="relative w-full aspect-[2/1] overflow-hidden" aria-hidden="true">
        <img
          :src="coverImageUrl"
          alt=""
          loading="lazy"
          decoding="async"
          class="object-cover w-full h-full group-hover:scale-105 transition-transform duration-500"
        >
      </div>

      <div class="p-6">
        <div class="flex items-start justify-between gap-4 mb-3">
          <h2 class="text-xl font-bold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 transition-colors duration-200 line-clamp-2 flex items-center flex-wrap gap-2">
            <span v-if="post.pinned" class="inline-flex items-center gap-1 px-2 py-0.5 bg-gradient-to-r from-orange-500 to-red-500 text-white text-xs font-semibold rounded-full shrink-0">
              <Icon icon="lucide:pin" class="w-3 h-3" />
              {{ t('components.postCard.pinned') }}
            </span>
            {{ post.title }}
          </h2>
          <Icon icon="lucide:arrow-right" class="w-5 h-5 text-gray-300 group-hover:text-blue-600 group-hover:translate-x-1 transition-all duration-300 shrink-0" />
        </div>

        <div class="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400 mb-4">
          <span class="flex items-center gap-1">
            <Icon icon="lucide:calendar" class="w-4 h-4" />
            {{ date }}
          </span>
          <span
            v-if="post.reading_time"
            class="flex items-center gap-1"
          >
            <Icon icon="lucide:clock" class="w-4 h-4" />
            {{ t('components.postCard.readingTime', { count: post.reading_time }) }}
          </span>
          <span class="flex items-center gap-1 ml-auto">
            <Icon icon="lucide:eye" class="w-4 h-4" />
            {{ post.views || 0 }}
          </span>
          <span v-if="post.comment_count" class="flex items-center gap-1">
            <Icon icon="lucide:message-square" class="w-4 h-4" />
            {{ post.comment_count }}
          </span>
        </div>

        <p
          v-if="post.excerpt"
          class="text-gray-600 dark:text-gray-300 mb-4 line-clamp-2 leading-relaxed"
        >
          {{ post.excerpt }}
        </p>
      </div>
    </NuxtLink>

    <!-- Category + tag chips sit OUTSIDE the card link (a nested interactive
         element inside a NuxtLink is invalid HTML, DEC-196/TASK-216), and each
         chip is itself a link to the filtered view so the feed's taxonomy is
         discoverable: the category chip (once a dead pill that looked clickable
         but did nothing, deep-dive ISS-375) now goes to /?category_id=, and
         tag chips go to /?tag_id= — exactly the sidebar/jump pattern. -->
    <div v-if="post.category || post.tags?.length" class="px-6 pb-6">
      <div class="flex flex-wrap gap-2 pt-2 border-t border-gray-50 dark:border-gray-800">
        <NuxtLink
          v-if="post.category"
          :to="{ path: '/', query: { category_id: String(post.category.id) } }"
          class="text-xs px-3 py-1.5 bg-gradient-to-r from-gray-50 dark:from-gray-800 to-gray-100 dark:to-gray-700 text-gray-600 dark:text-gray-300 rounded-full font-medium hover:from-gray-100 dark:hover:from-gray-700 hover:to-gray-200 dark:hover:to-gray-600 hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200"
        >
          <Icon icon="lucide:folder" class="w-3 h-3 inline mr-0.5" />
          {{ post.category.name }}
        </NuxtLink>
        <NuxtLink
          v-for="tag in post.tags" :key="tag.id"
          :to="{ path: '/', query: { tag_id: String(tag.id) } }"
          class="text-xs px-3 py-1.5 bg-gradient-to-r from-blue-50 dark:from-blue-900/30 to-indigo-50 dark:to-indigo-900/30 text-blue-600 dark:text-blue-400 rounded-full font-medium hover:from-blue-100 dark:hover:from-blue-900/50 hover:to-indigo-100 dark:hover:to-indigo-900/50 transition-colors duration-200"
        >
          #{{ tag.name }}
        </NuxtLink>
      </div>
    </div>
  </article>
</template>
