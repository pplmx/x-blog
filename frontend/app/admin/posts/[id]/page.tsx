'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePost, useCreatePost, useUpdatePost } from '@/lib/hooks';

export default function PostEditPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const isNew = params.id === 'new';
  const postId = isNew ? null : parseInt(params.id);

  const { data: post, isLoading } = usePost(isNew ? '' : params.id);
  const createPost = useCreatePost();
  const updatePost = useUpdatePost();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const formData = new FormData(e.currentTarget);
    const data = {
      title: formData.get('title') as string,
      slug: formData.get('slug') as string,
      content: formData.get('content') as string,
      excerpt: (formData.get('excerpt') as string) || undefined,
      published: formData.get('published') === 'on',
    };

    if (isNew) {
      await createPost.mutateAsync(data);
    } else if (postId) {
      await updatePost.mutateAsync({ id: postId, data });
    }

    router.push('/admin/posts');
  };

  if (!isNew && isLoading) return <div>加载中...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{isNew ? '新建文章' : '编辑文章'}</h1>

      <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl">
        <div>
          <label className="block text-sm font-medium mb-1">标题</label>
          <Input name="title" defaultValue={post?.title} required />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Slug</label>
          <Input name="slug" defaultValue={post?.slug} required />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">摘要</label>
          <Input name="excerpt" defaultValue={post?.excerpt || ''} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">内容 (Markdown)</label>
          <textarea
            name="content"
            defaultValue={post?.content}
            required
            className="w-full h-64 rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            name="published"
            id="published"
            defaultChecked={post?.published ?? false}
          />
          <label htmlFor="published">发布</label>
        </div>

        <div className="flex gap-2">
          <Button type="submit" disabled={createPost.isPending || updatePost.isPending}>
            {createPost.isPending || updatePost.isPending ? '保存中...' : '保存'}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push('/admin/posts')}>
            取消
          </Button>
        </div>
      </form>
    </div>
  );
}
