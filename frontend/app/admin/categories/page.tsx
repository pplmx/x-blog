'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Pencil, Check, X, FolderOpen } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchAdminCategories,
  createAdminCategory,
  deleteAdminCategory,
  updateAdminCategory,
} from '@/lib/api';

export default function CategoriesPage() {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const queryClient = useQueryClient();

  const {
    data: categories,
    isLoading,
    error,
  } = useQuery({
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

  const updateCategory = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => updateAdminCategory(id, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-categories'] });
      setEditingId(null);
      setEditName('');
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

  const handleStartEdit = (id: number, name: string) => {
    setEditingId(id);
    setEditName(name);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    await updateCategory.mutateAsync({ id: editingId, name: editName });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName('');
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这个分类吗？')) return;
    await deleteCategory.mutateAsync(id);
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent">
            分类管理
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            共 {categories?.length || 0} 个分类
          </p>
        </div>
      </div>

      {/* 添加表单 */}
      <div className="bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 rounded-2xl p-5 mb-6 border border-gray-100 dark:border-gray-800">
        <form onSubmit={handleCreate} className="flex gap-3">
          <div className="relative flex-1">
            <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="新分类名称"
              className="pl-10 h-11"
            />
          </div>
          <Button
            type="submit"
            disabled={createCategory.isPending}
            className="bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 shadow-md shadow-blue-500/20"
          >
            <Plus className="mr-2 h-4 w-4" />
            添加
          </Button>
        </form>
      </div>

      {/* 分类列表 */}
      {isLoading ? (
        <div className="text-center py-12">
          <div className="inline-flex items-center gap-2 text-gray-500">
            <svg aria-label="加载中" className="animate-spin w-5 h-5" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            加载中...
          </div>
        </div>
      ) : error ? (
        <div className="text-center py-12 text-red-500">{String(error)}</div>
      ) : categories?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800">
          <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
            <FolderOpen className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-700 dark:text-gray-300 mb-1">暂无分类</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">添加你的第一个分类吧</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((cat) => (
            <div
              key={cat.id}
              className="flex items-center justify-between p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 hover:border-purple-200 dark:hover:border-purple-800 hover:shadow-md transition-all duration-200"
            >
              {editingId === cat.id ? (
                <>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="flex-1 mr-2 h-9"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveEdit();
                      if (e.key === 'Escape') handleCancelEdit();
                    }}
                  />
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleSaveEdit}
                      disabled={updateCategory.isPending}
                      className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCancelEdit}
                      className="h-8 w-8 p-0 text-gray-500 hover:text-gray-600 hover:bg-gray-100"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-900/30 flex items-center justify-center">
                      <FolderOpen className="w-4 h-4 text-purple-500" />
                    </div>
                    <span className="font-medium text-gray-700 dark:text-gray-300">{cat.name}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleStartEdit(cat.id, cat.name)}
                      className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(cat.id)}
                      disabled={deleteCategory.isPending}
                      className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
