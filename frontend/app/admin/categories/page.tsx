'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchAdminCategories, createAdminCategory, deleteAdminCategory } from '@/lib/api';

export default function CategoriesPage() {
  const [newName, setNewName] = useState('');
  const queryClient = useQueryClient();

  const { data: categories, isLoading, error } = useQuery({
    queryKey: ['admin-categories'],
    queryFn: fetchAdminCategories,
  });

  const createCategory = useMutation({
    mutationFn: createAdminCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-categories'] });
      setNewName('');
    },
  });

  const deleteCategory = useMutation({
    mutationFn: deleteAdminCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-categories'] });
    },
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await createCategory.mutateAsync(newName);
    setNewName('');
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这个分类吗？')) return;
    await deleteCategory.mutateAsync(id);
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDelete(cat.id)}
              disabled={deleteCategory.isPending}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}