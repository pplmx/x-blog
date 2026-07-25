<template>
  <div class="max-w-3xl mx-auto">
    <!-- 返回按钮 -->
    <NuxtLink
      to="/"
      class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-600 transition-colors mb-8"
    >
      <Icon icon="lucide:arrow-left" class="w-4 h-4" />
      返回首页
    </NuxtLink>

    <!-- 头部 -->
    <div class="text-center mb-12">
      <div
        class="inline-flex items-center justify-center w-24 h-24 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-3xl shadow-xl shadow-blue-600/25 mb-6"
      >
        <Icon icon="lucide:sparkles" class="w-12 h-12 text-white" />
      </div>
      <h1
        class="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent mb-3"
      >
        关于 X-Blog
      </h1>
      <p class="text-gray-500 dark:text-gray-400">一个现代化的技术博客系统</p>
    </div>

    <!-- 介绍 -->
    <div
      class="bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 rounded-2xl p-6 sm:p-8 mb-8 border border-gray-100 dark:border-gray-800"
    >
      <p class="text-gray-600 dark:text-gray-300 leading-relaxed mb-4">
        X-Blog
        是一个简洁优雅的技术博客系统，采用现代前端与后端技术构建。我们致力于为开发者提供一个轻量、快速、且美观的博客平台。
      </p>
      <p class="text-gray-600 dark:text-gray-300 leading-relaxed">
        无论是分享技术心得、记录学习笔记，还是发布项目动态，X-Blog
        都能为你提供出色的写作与阅读体验。
      </p>
    </div>

    <!-- 技术栈 -->
    <div class="mb-8">
      <h2 class="text-lg font-bold mb-4 flex items-center gap-2 text-gray-900 dark:text-gray-100">
        <Icon icon="lucide:code-2" class="w-5 h-5 text-blue-600" />
        技术栈
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
          <p class="text-xs text-gray-500 dark:text-gray-400">{{ tech.desc }}</p>
        </div>
      </div>
    </div>

    <!-- 功能列表 -->
    <div class="mb-8">
      <h2 class="text-lg font-bold mb-4 text-gray-900 dark:text-gray-100">核心功能</h2>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div
          v-for="feature in features"
          :key="feature"
          class="bg-gradient-to-r from-blue-50 dark:from-blue-900/30 to-indigo-50 dark:to-indigo-900/30 border border-blue-100 dark:border-blue-900/50 rounded-xl px-4 py-3 text-sm text-blue-700 dark:text-blue-300 font-medium text-center hover:shadow-md transition-shadow"
        >
          {{ feature }}
        </div>
      </div>
    </div>

    <!-- 页脚 -->
    <div class="text-center pt-8 border-t border-gray-100 dark:border-gray-800">
      <p class="text-gray-500 dark:text-gray-400 text-sm flex items-center justify-center gap-2">
        Made with <Icon icon="lucide:heart" class="w-4 h-4 text-red-500 animate-pulse" /> for developers
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
const techStack = [
  { icon: "lucide:globe", name: "Nuxt", desc: "前端框架", color: "from-black to-gray-800" },
  { icon: "lucide:code-2", name: "FastAPI", desc: "后端框架", color: "from-green-500 to-green-700" },
  { icon: "lucide:database", name: "SQLAlchemy", desc: "ORM", color: "from-orange-500 to-red-500" },
  { icon: "lucide:sparkles", name: "TypeScript", desc: "语言", color: "from-blue-500 to-blue-700" },
];

const features = [
  "Markdown 文章支持",
  "分类与标签管理",
  "评论系统",
  "阅读量统计",
  "RSS 订阅",
  "SEO 优化",
  "响应式设计",
  "管理后台",
];
</script>

<route lang="json">
{
  "meta": {
    "title": "关于",
    "description": "关于 X-Blog - 技术博客系统"
  }
}
</route>
