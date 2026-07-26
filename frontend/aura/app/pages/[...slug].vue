<template>
  <div class="min-h-[60vh] flex items-center justify-center px-4">
    <div class="text-center max-w-md">
      <!-- Animated 404 -->
      <div class="relative mb-8">
        <h1
          class="text-[10rem] font-bold bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 bg-clip-text text-transparent leading-none animate-pulse"
        >
          404
        </h1>
        <div
          class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        >
          <div
            class="w-32 h-32 border-4 border-gray-200 dark:border-gray-700 rounded-full animate-spin border-t-blue-500"
          />
        </div>
      </div>

      <h2 class="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">
        页面不存在
      </h2>
      <p class="text-gray-500 dark:text-gray-400 mb-8">
        抱歉，你访问的页面已不存在或已被删除。
      </p>

      <div class="flex flex-col sm:flex-row gap-4 justify-center">
        <NuxtLink
          to="/"
          class="inline-flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-medium hover:from-blue-600 hover:to-indigo-600 transition-all shadow-md hover:shadow-lg"
        >
          <Icon icon="lucide:home" class="w-4 h-4" />
          返回首页
        </NuxtLink>
        <NuxtLink
          to="/search"
          class="inline-flex items-center justify-center gap-2 px-6 py-3 border border-gray-200 dark:border-gray-700 rounded-xl font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          <Icon icon="lucide:search" class="w-4 h-4" />
          搜索文章
        </NuxtLink>
      </div>
    </div>
  </div>
</template>

<route lang="json">
{
  "meta": {
    "title": "404 - 页面不存在",
    "description": "X-Blog - 页面未找到"
  }
}
</route>
