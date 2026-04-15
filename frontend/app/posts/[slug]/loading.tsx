import { PostDetailSkeleton } from '@/components/Skeleton';

export default function Loading() {
  return (
    <div className="animate-pulse">
      <PostDetailSkeleton />
    </div>
  );
}
