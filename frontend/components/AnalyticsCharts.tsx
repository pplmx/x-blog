'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ef4444'];

// Top posts by views
export function TopPostsChart({ posts }: { posts: { title: string; views: number }[] }) {
  const topPosts = [...posts]
    .filter((p) => p.views > 0)
    .sort((a, b) => b.views - a.views)
    .slice(0, 8)
    .map((p) => ({
      name: p.title.length > 20 ? `${p.title.slice(0, 20)}…` : p.title,
      views: p.views,
    }));

  if (topPosts.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={topPosts} layout="vertical" margin={{ left: 0, right: 16 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          className="stroke-gray-200 dark:stroke-gray-700"
          horizontal={false}
        />
        <XAxis type="number" tick={{ fontSize: 12 }} className="fill-muted-foreground" />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 11 }}
          className="fill-muted-foreground"
          width={120}
        />
        <Tooltip
          contentStyle={{
            borderRadius: 8,
            border: '1px solid rgb(229 231 235)',
            fontSize: 12,
          }}
          labelStyle={{ fontWeight: 600 }}
          formatter={(value: number) => [`${value} 次阅读`, '浏览量']}
        />
        <Bar dataKey="views" fill="#3b82f6" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// Category distribution pie chart
export function CategoryPieChart({
  categories,
  posts,
}: {
  categories: { id: number; name: string }[];
  posts: { category_id: number | null; published: boolean }[];
}) {
  const publishedPosts = posts.filter((p) => p.published);
  const data = categories
    .map((cat) => ({
      name: cat.name,
      value: publishedPosts.filter((p) => p.category_id === cat.id).length,
    }))
    .filter((d) => d.value > 0);

  if (data.length === 0) return null;

  return (
    <div className="flex items-center gap-6">
      <ResponsiveContainer width="50%" height={200}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
            dataKey="value"
          >
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ borderRadius: 8, border: '1px solid rgb(229 231 235)', fontSize: 12 }}
            formatter={(value: number) => [`${value} 篇`, '文章数']}
          />
        </PieChart>
      </ResponsiveContainer>
      {/* Legend */}
      <div className="space-y-2 flex-1">
        {data.map((entry, index) => (
          <div key={entry.name} className="flex items-center gap-2 text-sm">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: COLORS[index % COLORS.length] }}
            />
            <span className="text-muted-foreground">{entry.name}</span>
            <span className="ml-auto font-medium">{entry.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
