'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2 } from 'lucide-react';
import { useCategories, useCreateCategory } from '@/lib/hooks';

export default function CategoriesPage() {
  const [newName, setNewName] = useState('');
  const { data: categories, isLoading, error } = useCategories();
  const createCategory = useCreateCategory();

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await createCategory.mutateAsync({ name: newName });
    setNewName('');
  };

  if (isLoading) return <div>加载中...</div>;
  if (error) return <div>加载失败: {String(error)}</div>;
  if (!categories) return <div>暂无数据</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">分类管理</h1>

      <form onSubmit={handleCreate} className="flex gap-2 mb-6">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="新分类名称"
        />
        <Button type="submit" disabled={createCategory.isPending}>
          <Plus className="mr-2 h-4 w-4" />
          添加
        </Button>
      </form>

      <div className="space-y-2">
        {categories.map((cat) => (
          <div key={cat.id} className="flex items-center justify-between p-3 border rounded-lg">
            <span>{cat.name}</span>
            <Button variant="ghost" size="sm">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
