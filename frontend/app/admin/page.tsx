import { fetchPosts, fetchCategories, fetchTags } from '@/lib/api';
import Link from 'next/link';
import { FileText, CheckCircle, Clock, Folder, Tag, Eye } from 'lucide-react';
import { TopPostsChart, CategoryPieChart } from '@/components/AnalyticsCharts';

export default async function AdminDashboard() {
  // 并行获取所有数据
  const [postsResponse, categories, tags] = await Promise.all([
    fetchPosts({ limit: 1000 }),
    fetchCategories(),
    fetchTags(),
  ]);

  const posts = postsResponse.items;
  const publishedCount = posts.filter((p) => p.published).length;
  const draftCount = posts.length - publishedCount;
  const totalViews = posts.reduce((sum, p) => sum + (p.views || 0), 0);

  // 获取最近5篇发布的文章
  const recentPosts = posts
    .filter((p) => p.published)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  const stats = [
    {
      title: '文章总数',
      value: posts.length,
      icon: FileText,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      title: '已发布',
      value: publishedCount,
      icon: CheckCircle,
      color: 'text-green-600',
      bg: 'bg-green-50',
    },
    { title: '草稿', value: draftCount, icon: Clock, color: 'text-yellow-600', bg: 'bg-yellow-50' },
    {
      title: '分类',
      value: categories.length,
      icon: Folder,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
    },
    { title: '标签', value: tags.length, icon: Tag, color: 'text-pink-600', bg: 'bg-pink-50' },
    {
      title: '总浏览量',
      value: totalViews,
      icon: Eye,
      color: 'text-orange-600',
      bg: 'bg-orange-50',
    },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent">
          仪表盘
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">博客数据总览</p>
      </div>

      {/* 统计卡片 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-8">
        {stats.map((stat) => (
          <div
            key={stat.title}
            className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5 hover:shadow-lg hover:border-gray-200 dark:hover:border-gray-700 transition-all duration-200"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{stat.title}</span>
              <div className={`p-2.5 rounded-xl ${stat.bg}`}>
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
              </div>
            </div>
            <div className="text-3xl font-bold text-gray-900 dark:text-gray-100">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* 图表区域 */}
      <div className="grid gap-6 lg:grid-cols-2 mb-8">
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-500" />
            热门文章 (浏览量)
          </h3>
          <TopPostsChart posts={posts} />
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
            <Folder className="w-5 h-5 text-purple-500" />
            文章分类分布
          </h3>
          <CategoryPieChart categories={categories} posts={posts} />
        </div>
      </div>

      {/* 最近文章 */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-green-500" />
          最近发布的文章
        </h3>
        {recentPosts.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-sm">暂无已发布的文章</p>
        ) : (
          <div className="space-y-2">
            {recentPosts.map((post) => (
              <Link
                key={post.id}
                href={`/admin/posts/${post.id}`}
                className="flex items-center justify-between p-4 rounded-xl hover:bg-gradient-to-r hover:from-blue-50 hover:to-indigo-50 dark:hover:from-blue-900/10 dark:hover:to-indigo-900/10 transition-colors group"
              >
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                    {post.title}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {new Date(post.created_at).toLocaleDateString('zh-CN')}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500">
                  <Eye className="w-4 h-4" />
                  {post.views || 0}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
