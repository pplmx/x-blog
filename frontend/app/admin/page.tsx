import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
      <h1 className="text-2xl font-bold mb-6">仪表盘</h1>

      {/* 统计卡片 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-8">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <div className={`p-2 rounded-lg ${stat.bg}`}>
                <stat.icon className={`h-4 w-4 ${stat.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 图表区域 */}
      <div className="grid gap-6 lg:grid-cols-2 mb-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">热门文章 (浏览量)</CardTitle>
          </CardHeader>
          <CardContent>
            <TopPostsChart posts={posts} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">文章分类分布</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryPieChart categories={categories} posts={posts} />
          </CardContent>
        </Card>
      </div>

      {/* 最近文章 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">最近发布的文章</CardTitle>
        </CardHeader>
        <CardContent>
          {recentPosts.length === 0 ? (
            <p className="text-muted-foreground text-sm">暂无已发布的文章</p>
          ) : (
            <div className="space-y-3">
              {recentPosts.map((post) => (
                <Link
                  key={post.id}
                  href={`/admin/posts/${post.id}`}
                  className="flex items-center justify-between p-2 rounded-lg hover:bg-muted transition-colors"
                >
                  <div>
                    <p className="font-medium">{post.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(post.created_at).toLocaleDateString('zh-CN')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Eye className="h-4 w-4" />
                    {post.views || 0}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
