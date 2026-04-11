'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchAdminTags, createAdminTag, deleteAdminTag, updateAdminTag } from '@/lib/api';

export default function TagsPage() {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const queryClient = useQueryClient();

  const { data: tags, isLoading, error } = useQuery({
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

  if (isLoading) return <div>加载中...</div>;
  if (error) return <div>加载失败: {String(error)}</div>;
  if (!tags) return <div>暂无数据</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">标签管理</h1>

      <form onSubmit={handleCreate} className="flex gap-2 mb-6">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="新标签名称"
        />
        <Button type="submit" disabled={createTag.isPending}>
          <Plus className="mr-2 h-4 w-4" />
          添加
        </Button>
      </form>

      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <div key={tag.id} className="flex items-center gap-2 p-2 border rounded-lg">
            {editingId === tag.id ? (
              <>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-24"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSaveEdit}
                  disabled={updateTag.isPending}
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
                  <X className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <span>{tag.name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleStartEdit(tag.id, tag.name)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(tag.id)}
                  disabled={deleteTag.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}