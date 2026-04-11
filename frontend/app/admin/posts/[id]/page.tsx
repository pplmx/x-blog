'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ImageUpload } from '@/components/ImageUpload';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchAdminPost,
  fetchAdminCategories,
  fetchAdminTags,
  createAdminPost,
  updateAdminPost,
  AdminPostDetail,
  PostCreate,
} from '@/lib/api';

export default function PostEditPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isNew = params.id === 'new';
  const postId = isNew ? null : parseInt(params.id);

  const [formData, setFormData] = useState<Partial<PostCreate>>({
    title: '',
    slug: '',
    content: '',
    excerpt: '',
    published: false,
    category_id: undefined,
    tag_ids: [],
    cover_image: undefined,
  });

  const { data: categories } = useQuery({
    queryKey: ['admin-categories'],
    queryFn: fetchAdminCategories,
  });

  const { data: tags } = useQuery({
    queryKey: ['admin-tags'],
    queryFn: fetchAdminTags,
  });

  const { data: post, isLoading } = useQuery({
    queryKey: ['admin-post', postId],
    queryFn: () => fetchAdminPost(postId as number),
    enabled: !!postId,
  });

  useEffect(() => {
    if (post) {
      setFormData({
        title: post.title,
        slug: post.slug,
        content: post.content,
        excerpt: post.excerpt,
        published: post.published,
        category_id: post.category_id ?? undefined,
        tag_ids: post.tag_ids,
        cover_image: post.cover_image ?? undefined,
      });
    }
  }, [post]);

  const createMutation = useMutation({
    mutationFn: createAdminPost,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-posts'] });
      router.push('/admin/posts');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<PostCreate> }) =>
      updateAdminPost(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-posts'] });
      router.push('/admin/posts');
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isNew) {
      await createMutation.mutateAsync(formData as PostCreate);
    } else if (postId) {
      await updateMutation.mutateAsync({ id: postId, data: formData });
    }
  };

  if (!isNew && isLoading) return <div>加载中...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{isNew ? '新建文章' : '编辑文章'}</h1>

      <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl">
        <div>
          <label className="block text-sm font-medium mb-1">封面图</label>
          <ImageUpload
            value={formData.cover_image || ''}
            onChange={(url) => setFormData({ ...formData, cover_image: url || undefined })}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">标题</label>
          <Input
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Slug</label>
          <Input
            value={formData.slug}
            onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">摘要</label>
          <Input
            value={formData.excerpt}
            onChange={(e) => setFormData({ ...formData, excerpt: e.target.value })}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">分类</label>
          <select
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            value={formData.category_id ?? ''}
            onChange={(e) =>
              setFormData({ ...formData, category_id: e.target.value ? parseInt(e.target.value) : undefined })
            }
          >
            <option value="">选择分类</option>
            {categories?.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">标签</label>
          <div className="flex flex-wrap gap-2">
            {tags?.map((tag) => (
              <label key={tag.id} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={formData.tag_ids?.includes(tag.id) ?? false}
                  onChange={(e) => {
                    const current = formData.tag_ids || [];
                    const newTags = e.target.checked
                      ? [...current, tag.id]
                      : current.filter((id) => id !== tag.id);
                    setFormData({ ...formData, tag_ids: newTags });
                  }}
                />
                {tag.name}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">内容 (Markdown)</label>
          <textarea
            value={formData.content}
            onChange={(e) => setFormData({ ...formData, content: e.target.value })}
            required
            className="w-full h-64 rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="published"
            checked={formData.published}
            onChange={(e) => setFormData({ ...formData, published: e.target.checked })}
          />
          <label htmlFor="published">发布</label>
        </div>

        <div className="flex gap-2">
          <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
            {createMutation.isPending || updateMutation.isPending ? '保存中...' : '保存'}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push('/admin/posts')}>
            取消
          </Button>
        </div>
      </form>
    </div>
  );
}