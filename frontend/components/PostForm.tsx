'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ImageUpload } from '@/components/ImageUpload';
import { PostCreate } from '@/lib/api';
import { Category, Tag } from '@/types';
import { Save, X, FileText, Tag as TagIcon, Folder, Image } from 'lucide-react';

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
    <form onSubmit={onSubmit} className="space-y-6 max-w-3xl">
      {/* 封面图 */}
      <div className="bg-card border rounded-xl p-4">
        <label className="flex items-center gap-2 text-sm font-medium mb-3">
          <Image className="w-4 h-4" />
          封面图
        </label>
        <ImageUpload
          value={formData.cover_image || ''}
          onChange={(url) => setFormData({ ...formData, cover_image: url || undefined })}
        />
      </div>

      {/* 基本信息 */}
      <div className="bg-card border rounded-xl p-4 space-y-4">
        <div>
          <label className="flex items-center gap-2 text-sm font-medium mb-2">
            <FileText className="w-4 h-4" />
            标题
          </label>
          <Input
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            placeholder="输入文章标题"
            className="text-lg"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Slug</label>
          <Input
            value={formData.slug}
            onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
            placeholder="article-slug"
          />
          <p className="text-xs text-muted-foreground mt-1">
            URL: /posts/{formData.slug || 'slug'}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">摘要</label>
          <Textarea
            value={formData.excerpt}
            onChange={(e) => setFormData({ ...formData, excerpt: e.target.value })}
            placeholder="输入文章摘要（可选）"
            rows={2}
          />
        </div>
      </div>

      {/* 分类和标签 */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* 分类 */}
        <div className="bg-card border rounded-xl p-4">
          <label className="flex items-center gap-2 text-sm font-medium mb-3">
            <Folder className="w-4 h-4" />
            分类
          </label>
          <select
            className="w-full rounded-lg border border-input bg-transparent px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500"
            value={formData.category_id ?? ''}
            onChange={(e) =>
              setFormData({
                ...formData,
                category_id: e.target.value ? parseInt(e.target.value) : undefined,
              })
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

        {/* 标签 */}
        <div className="bg-card border rounded-xl p-4">
          <label className="flex items-center gap-2 text-sm font-medium mb-3">
            <TagIcon className="w-4 h-4" />
            标签
          </label>
          {tags && tags.length > 0 ? (
            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
              {tags.map((tag) => (
                <label
                  key={tag.id}
                  className={`
                    flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm cursor-pointer transition-all
                    ${
                      formData.tag_ids?.includes(tag.id)
                        ? 'bg-blue-100 text-blue-700 border border-blue-200'
                        : 'bg-gray-50 text-gray-600 border border-gray-100 hover:border-gray-200'
                    }
                  `}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={formData.tag_ids?.includes(tag.id) ?? false}
                    onChange={(e) => {
                      const current = formData.tag_ids || [];
                      const newTags = e.target.checked
                        ? [...current, tag.id]
                        : current.filter((id) => id !== tag.id);
                      setFormData({ ...formData, tag_ids: newTags });
                    }}
                  />
                  #{tag.name}
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">暂无标签</p>
          )}
        </div>
      </div>

      {/* 内容 */}
      <div className="bg-card border rounded-xl p-4">
        <label className="block text-sm font-medium mb-2">内容 (Markdown)</label>
        <Textarea
          value={formData.content}
          onChange={(e) => setFormData({ ...formData, content: e.target.value })}
          placeholder="使用 Markdown 编写文章内容..."
          className="font-mono text-sm min-h-[300px]"
          required
        />
        <p className="text-xs text-muted-foreground mt-2">
          支持 Markdown 语法：标题、列表、代码块、链接等
        </p>
      </div>

      {/* 发布选项 */}
      <div className="bg-card border rounded-xl p-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            id="published"
            checked={formData.published}
            onChange={(e) => setFormData({ ...formData, published: e.target.checked })}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm font-medium">
            {formData.published ? '✅ 文章已发布' : '📝 保存为草稿'}
          </span>
        </label>
      </div>

      {/* 提交按钮 */}
      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={isSubmitting} size="lg">
          <Save className="mr-2 h-4 w-4" />
          {isSubmitting ? '保存中...' : '保存文章'}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" size="lg" onClick={onCancel}>
            <X className="mr-2 h-4 w-4" />
            取消
          </Button>
        )}
      </div>
    </form>
  );
}
