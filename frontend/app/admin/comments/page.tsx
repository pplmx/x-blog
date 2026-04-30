'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Trash2,
  MessageCircle,
  Calendar,
  User,
  Globe,
  CheckCircle,
  XCircle,
  Filter,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchAdminComments,
  deleteAdminComment,
  approveAdminComment,
  AdminComment,
} from '@/lib/api';
import Link from 'next/link';

type FilterMode = 'all' | 'pending' | 'approved';

export default function CommentsPage() {
  const queryClient = useQueryClient();
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [filterPostId] = useState<number | undefined>(undefined);

  const {
    data: allComments,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['admin-comments', filterPostId],
    queryFn: () => fetchAdminComments(filterPostId),
  });

  const filteredComments =
    allComments?.filter((c) => {
      if (filterMode === 'pending') return !c.is_approved;
      if (filterMode === 'approved') return c.is_approved;
      return true;
    }) ?? [];

  const pendingCount = allComments?.filter((c) => !c.is_approved).length ?? 0;

  const deleteMutation = useMutation({
    mutationFn: deleteAdminComment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-comments'] });
    },
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, approved }: { id: number; approved: boolean }) =>
      approveAdminComment(id, approved),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-comments'] });
    },
  });

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这条评论吗？')) return;
    await deleteMutation.mutateAsync(id);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-12 text-red-500">加载失败: {String(error)}</div>;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent">
            评论管理
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            共 {allComments?.length || 0} 条评论
            {pendingCount > 0 && (
              <span className="ml-2 text-orange-500 font-medium">· {pendingCount} 条待审核</span>
            )}
          </p>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 bg-gradient-to-r from-gray-100 dark:from-gray-800 to-white dark:to-gray-900 rounded-xl p-1.5 border border-gray-100 dark:border-gray-800">
          {(['all', 'pending', 'approved'] as FilterMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setFilterMode(mode)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                filterMode === mode
                  ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-md shadow-blue-500/25'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              {mode === 'all' ? '全部' : mode === 'pending' ? '待审核' : '已通过'}
              {mode === 'pending' && pendingCount > 0 && (
                <span
                  className={`ml-1.5 text-xs rounded-full px-1.5 py-0.5 ${
                    filterMode === mode
                      ? 'bg-white/20 text-white'
                      : 'bg-orange-100 text-orange-600 dark:bg-orange-900/50'
                  }`}
                >
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {filteredComments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800">
          <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
            <MessageCircle className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-700 dark:text-gray-300 mb-1">
            {filterMode === 'pending' ? '暂无待审核评论' : '暂无评论'}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {filterMode === 'pending' ? '所有评论都已审核完毕' : '等待读者留下评论'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredComments.map((comment) => (
            <div
              key={comment.id}
              className={`bg-card border rounded-xl p-4 hover:border-gray-300 transition-colors ${
                !comment.is_approved
                  ? 'border-orange-200 bg-orange-50/30 dark:bg-orange-950/10'
                  : ''
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {/* 评论者信息 */}
                  <div className="flex items-center gap-3 mb-2">
                    {/* 审核状态标签 */}
                    {!comment.is_approved && (
                      <span className="inline-flex items-center gap-1 text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
                        <XCircle className="w-3 h-3" />
                        待审核
                      </span>
                    )}
                    <div className="flex items-center gap-1.5 text-sm">
                      <User className="w-4 h-4 text-gray-400" />
                      <span className="font-medium">{comment.nickname}</span>
                    </div>
                    {comment.email && (
                      <span className="text-xs text-muted-foreground">{comment.email}</span>
                    )}
                  </div>

                  {/* 所属文章 */}
                  <div className="mb-2">
                    <Link
                      href={`/admin/posts/${comment.post_id}`}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      文章: {comment.post_title}
                    </Link>
                  </div>

                  {/* 评论内容 */}
                  <div className="bg-muted/50 rounded-lg p-3 mb-3">
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{comment.content}</p>
                  </div>

                  {/* 元信息 */}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      {formatDate(comment.created_at)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Globe className="w-3.5 h-3.5" />
                      {comment.ip_address}
                    </span>
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className="flex flex-col gap-1 shrink-0">
                  {!comment.is_approved && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => approveMutation.mutate({ id: comment.id, approved: true })}
                      disabled={approveMutation.isPending}
                      className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                      title="通过"
                    >
                      <CheckCircle className="h-4 w-4" />
                    </Button>
                  )}
                  {comment.is_approved && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => approveMutation.mutate({ id: comment.id, approved: false })}
                      disabled={approveMutation.isPending}
                      className="h-8 w-8 p-0 text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                      title="取消通过"
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(comment.id)}
                    disabled={deleteMutation.isPending}
                    className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-50"
                    title="删除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
