'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Pencil, Check, X, Tag as TagIcon } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchAdminTags, createAdminTag, deleteAdminTag, updateAdminTag } from '@/lib/api';

export default function TagsPage() {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const queryClient = useQueryClient();

  const {
    data: tags,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['admin-tags'],
    queryFn: fetchAdminTags,
  });

  const createTag = useMutation({
    mutationFn: createAdminTag,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tags'] });
      setNewName('');
    },
  });

  const updateTag = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => updateAdminTag(id, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tags'] });
      setEditingId(null);
      setEditName('');
    },
  });

  const deleteTag = useMutation({
    mutationFn: deleteAdminTag,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tags'] });
    },
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await createTag.mutateAsync(newName);
    setNewName('');
  };

  const handleStartEdit = (id: number, name: string) => {
    setEditingId(id);
    setEditName(name);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    await updateTag.mutateAsync({ id: editingId, name: editName });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName('');
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这个标签吗？')) return;
    await deleteTag.mutateAsync(id);
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent">
            标签管理
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            共 {tags?.length || 0} 个标签
          </p>
        </div>
      </div>

      {/* 添加表单 */}
      <div className="bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 rounded-2xl p-5 mb-6 border border-gray-100 dark:border-gray-800">
        <form onSubmit={handleCreate} className="flex gap-3">
          <div className="relative flex-1">
            <TagIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="新标签名称"
              className="pl-10 h-11"
            />
          </div>
          <Button
            type="submit"
            disabled={createTag.isPending}
            className="bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 shadow-md shadow-pink-500/20"
          >
            <Plus className="mr-2 h-4 w-4" />
            添加
          </Button>
        </form>
      </div>

      {/* 标签列表 */}
      {isLoading ? (
        <div className="text-center py-12">
          <div className="inline-flex items-center gap-2 text-gray-500">
            <svg aria-label="加载中" className="animate-spin w-5 h-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            加载中...
          </div>
        </div>
      ) : error ? (
        <div className="text-center py-12 text-red-500">{String(error)}</div>
      ) : tags?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800">
          <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
            <TagIcon className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-700 dark:text-gray-300 mb-1">暂无标签</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">添加你的第一个标签吧</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {tags.map((tag) => (
            <div
              key={tag.id}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 hover:border-pink-200 dark:hover:border-pink-800 hover:shadow-md transition-all duration-200"
            >
              {editingId === tag.id ? (
                <>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-32 h-8"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveEdit();
                      if (e.key === 'Escape') handleCancelEdit();
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSaveEdit}
                    disabled={updateTag.isPending}
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
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-pink-50 dark:bg-pink-900/30 flex items-center justify-center">
                      <TagIcon className="w-3.5 h-3.5 text-pink-500" />
                    </div>
                    <span className="font-medium text-gray-700 dark:text-gray-300">#{tag.name}</span>
                  </div>
                  <div className="flex gap-0.5 ml-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleStartEdit(tag.id, tag.name)}
                      className="h-7 w-7 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(tag.id)}
                      disabled={deleteTag.isPending}
                      className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
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
