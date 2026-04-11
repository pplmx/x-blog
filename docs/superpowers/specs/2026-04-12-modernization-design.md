# X-Blog 前端现代化设计

> **Created:** 2026-04-12

## Goal

为 X-Blog 添加三个现代化工具：TanStack Query、Playwright E2E、MSW

---

## 1. TanStack Query

### 作用
替换手动 fetch，实现：
- 自动缓存
- 后台重新获取
- 加载/错误状态
- 乐观更新

### 实现
```typescript
// lib/query-client.ts
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      retry: 1,
    },
  },
});

// 使用示例
import { useQuery } from "@tanstack/react-query";

function PostList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["posts"],
    queryFn: () => fetchPosts(),
  });
  
  if (isLoading) return <div>加载中...</div>;
  if (error) return <div>错误</div>;
  
  return data.items.map(post => <PostCard key={post.id} post={post} />);
}
```

---

## 2. Playwright E2E

### 作用
端到端测试，覆盖真实用户交互流程

### 测试用例
- 首页加载
- 文章列表分页
- 搜索功能
- 评论提交

### 配置
```yaml
# playwright.config.ts
export default defineConfig({
  testDir: "./e2e",
  baseURL: "http://localhost:3000",
  webServer: {
    command: "pnpm dev",
    port: 3000,
    reuseExistingServer: true,
  },
});
```

---

## 3. MSW (Mock Service Worker)

### 作用
在前端模拟 API 响应，脱离后端依赖

### 使用场景
- 独立开发前端
- 单元测试
- E2E 测试

### 配置
```typescript
// mocks/handlers.ts
import { http, HttpResponse } from "msw";

export const handlers = [
  http.get("/api/posts", () => {
    return HttpResponse.json({
      items: [{ id: 1, title: "Mock Post" }],
      pagination: { total: 1, page: 1, limit: 10, total_pages: 1 }
    });
  }),
];

// mocks/browser.ts
import { setupWorker } from "msw/browser";
export const worker = setupWorker(...handlers);
```

---

## 实现顺序

1. TanStack Query（核心 API 层）
2. MSW（测试支持）
3. Playwright（E2E 测试）

每个独立实现，完成后测试通过再进行下一个。