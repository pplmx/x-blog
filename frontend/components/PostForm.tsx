'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ImageUpload } from '@/components/ImageUpload';
import { PostCreate } from '@/lib/api';
import { Category, Tag } from '@/types';

interface PostFormProps {
  formData: Partial<PostCreate>;
  setFormData: (data: Partial<PostCreate>) => void;
  categories?: Category[];
  tags?: Tag[];
  isLoading?: boolean;
  isSubmitting?: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancel?: () => void;
}

export function PostForm({
  formData,
  setFormData,
  categories,
  tags,
  isSubmitting = false,
  onSubmit,
  onCancel,
}: PostFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-4 max-w-2xl">
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
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? '保存中...' : '保存'}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            取消
          </Button>
        )}
      </div>
    </form>
  );
}