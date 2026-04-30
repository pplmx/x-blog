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
      <div className="bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5">
        <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
          <Image className="w-4 h-4 text-blue-500" />
          封面图
        </label>
        <ImageUpload
          value={formData.cover_image || ''}
          onChange={(url) => setFormData({ ...formData, cover_image: url || undefined })}
        />
      </div>

      {/* 基本信息 */}
      <div className="bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 space-y-5">
        <div>
          <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            <FileText className="w-4 h-4 text-blue-500" />
            标题 <span className="text-red-500">*</span>
          </label>
          <Input
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            placeholder="输入文章标题"
            className="text-lg h-12"
            required
          />
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            <svg
              aria-label="链接图标"
              className="w-4 h-4 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
              />
            </svg>
            Slug
          </label>
          <Input
            value={formData.slug}
            onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
            placeholder="article-slug"
            className="font-mono"
          />
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
            URL: /posts/{formData.slug || 'slug'}
          </p>
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            <svg
              aria-label="标签图标"
              className="w-4 h-4 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h7"
              />
            </svg>
            摘要
          </label>
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
        <div className="bg-gradient-to-br from-purple-50 dark:from-purple-900/20 to-white dark:to-gray-900 border border-purple-100 dark:border-purple-900/30 rounded-2xl p-5">
          <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            <Folder className="w-4 h-4 text-purple-500" />
            分类
          </label>
          <select
            className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
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
        <div className="bg-gradient-to-br from-pink-50 dark:from-pink-900/20 to-white dark:to-gray-900 border border-pink-100 dark:border-pink-900/30 rounded-2xl p-5">
          <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            <TagIcon className="w-4 h-4 text-pink-500" />
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
                        ? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-md'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-pink-100 dark:hover:bg-pink-900/50'
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
            <p className="text-sm text-gray-400 dark:text-gray-500">暂无标签</p>
          )}
        </div>
      </div>

      {/* 内容 */}
      <div className="bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5">
        <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
          <svg
            aria-label="内容编辑"
            className="w-4 h-4 text-blue-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
            />
          </svg>
          内容 (Markdown) <span className="text-red-500">*</span>
        </label>
        <Textarea
          value={formData.content}
          onChange={(e) => setFormData({ ...formData, content: e.target.value })}
          placeholder="使用 Markdown 编写文章内容..."
          className="font-mono text-sm min-h-[300px]"
          required
        />
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
          支持 Markdown 语法：标题、列表、代码块、链接等
        </p>
      </div>

      {/* 发布选项 */}
      <div className="bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5">
        <label className="flex items-center gap-3 cursor-pointer group">
          <input
            type="checkbox"
            id="published"
            checked={formData.published}
            onChange={(e) => setFormData({ ...formData, published: e.target.checked })}
            className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-blue-600 transition-colors">
            {formData.published ? '✅ 文章已发布' : '📝 保存为草稿'}
          </span>
        </label>
      </div>

      {/* 提交按钮 */}
      <div className="flex items-center gap-3 pt-2">
        <Button
          type="submit"
          disabled={isSubmitting}
          size="lg"
          className="bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 shadow-lg shadow-blue-500/20"
        >
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
