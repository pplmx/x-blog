<script setup lang="ts">
import { ref } from 'vue';
import type { Category, Tag } from '~/composables/useApi';

interface Props {
  categories: Category[];
  tags: Tag[];
}

const props = defineProps<Props>();

const { categories, tags } = toRefs(props);

const isOpen = ref(false);
const route = useRoute();
const currentCategory = route.query.category_id;
const currentTag = route.query.tag_id;
const hasFilters = computed(() => currentCategory || currentTag);

function clearFilters() {
  navigateTo('/');
  isOpen.value = false;
}

function getActiveCategoryName() {
  if (!currentCategory) return null;
  const cat = props.categories.find((c) => c.id === parseInt(String(currentCategory)));
  return cat?.name;
}

function getActiveTagName() {
  if (!currentTag) return null;
  const tag = props.tags.find((t) => t.id === parseInt(String(currentTag)));
  return tag?.name;
}
</script>

<template>
  <>
    <!-- Trigger button (mobile only) -->
    <div class="lg:hidden flex items-center justify-between mb-4">
      <div class="flex items-center gap-2">
        <span v-if="hasFilters" class="text-sm text-blue-600 dark:text-blue-400">
          筛选中: {{ getActiveCategoryName() || getActiveTagName() }}
        </span>
        <span v-else class="text-sm text-gray-500 dark:text-gray-400">
          全部文章
        </span>
      </div>
      <button
        @click="isOpen = true"
        class="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-gray-50 dark:from-gray-800 to-white dark:to-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:border-blue-300 dark:hover:border-gray-700 transition-colors"
      >
        <Icon icon="lucide:filter" class="w-4 h-4" />
        筛选
        <span v-if="hasFilters" class="w-2 h-2 bg-blue-500 rounded-full" />
      </button>
    </div>

    <!-- Filter panel (mobile only) -->
    <transition name="slide">
      <div v-if="isOpen">
        <!-- Background overlay -->
        <button
          type="button"
          class="fixed inset-0 bg-black/50 z-50 lg:hidden cursor-default"
          @click="isOpen = false"
          aria-label="关闭筛选面板"
        />

        <!-- Bottom sheet -->
        <div
          class="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-white dark:bg-gray-900 rounded-t-2xl shadow-2xl max-h-[70vh] overflow-auto"
        >
          <!-- Header -->
          <div
            class="sticky top-0 flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900"
          >
            <h3 class="text-lg font-bold text-gray-900 dark:text-gray-100">筛选</h3>
            <button
              @click="isOpen = false"
              class="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            >
              <Icon icon="lucide:x" class="w-5 h-5" />
            </button>
          </div>

          <!-- Clear filters -->
          <div v-if="hasFilters" class="px-5 py-3 border-b border-gray-100 dark:border-gray-800">
            <button
              @click="clearFilters"
              class="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 transition-colors"
            >
              <Icon icon="lucide:x" class="w-4 h-4" />
              清除所有筛选
            </button>
          </div>

          <div class="p-5 space-y-6">
            <!-- Categories -->
            <div>
              <h4
                class="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3"
              >
                <Icon icon="lucide:folder-open" class="w-4 h-4 text-purple-500" />
                分类
              </h4>
              <div class="flex flex-wrap gap-2">
                <NuxtLink
                  v-for="cat in categories"
                  :key="cat.id"
                  :to="[`?category_id=${cat.id}`]"
                  @click="isOpen = false"
                  :class="[
                    'px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200',
                    currentCategory === String(cat.id)
                      ? 'bg-gradient-to-r from-purple-500 to-indigo-500 text-white shadow-md'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-purple-100 dark:hover:bg-purple-900/50 hover:text-purple-600',
                  ]"
                >
                  {{ cat.name }}
                </NuxtLink>
              </div>
            </div>

            <!-- Tags -->
            <div>
              <h4
                class="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3"
              >
                <Icon icon="lucide:tag" class="w-4 h-4 text-pink-500" />
                标签
              </h4>
              <div class="flex flex-wrap gap-2">
                <NuxtLink
                  v-for="tag in tags"
                  :key="tag.id"
                  :to="[`?tag_id=${tag.id}`]"
                  @click="isOpen = false"
                  :class="[
                    'px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200',
                    currentTag === String(tag.id)
                      ? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-md'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-pink-100 dark:hover:bg-pink-900/50 hover:text-pink-600',
                  ]"
                >
                  #{{ tag.name }}
                </NuxtLink>
              </div>
            </div>
          </div>

          <!-- Safe area -->
          <div class="h-6" />
        </div>
      </div>
    </transition>
  </>
</template>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: opacity 0.3s ease;
}
.slide-enter-from,
.slide-leave-to {
  opacity: 0;
}
</style>
