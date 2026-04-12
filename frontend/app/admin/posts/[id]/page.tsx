'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PostForm } from '@/components/PostForm';
import {
  fetchAdminPost,
  fetchAdminCategories,
  fetchAdminTags,
  createAdminPost,
  updateAdminPost,
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
      <div className="mb-6">
        <h1 className="text-2xl font-bold">
          {isNew ? '新建文章' : '编辑文章'}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isNew ? '创建一个新的博客文章' : '修改文章内容和设置'}
        </p>
      </div>

      <PostForm
        formData={formData}
        setFormData={setFormData}
        categories={categories}
        tags={tags}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        onSubmit={handleSubmit}
        onCancel={() => router.push('/admin/posts')}
      />
    </div>
  );
}