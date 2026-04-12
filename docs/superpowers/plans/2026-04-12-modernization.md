# Frontend Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 添加三个现代化前端工具：TanStack Query、Playwright E2E、MSW

**Architecture:**

- TanStack Query 替换手动 fetch，添加缓存和状态管理
- MSW 提供 API mock，支持独立开发和测试
- Playwright E2E 测试覆盖关键用户流程

**Tech Stack:** TanStack Query, Playwright, MSW

---

## 文件结构

```text
frontend/
├── lib/
│   └── query-client.ts     # 新增: QueryClient 配置
├── app/
│   └── layout.tsx          # 修改: 添加 QueryClientProvider
├── mocks/
│   ├── handlers.ts         # 新增: API mock handlers
│   ├── browser.ts          # 新增: MSW browser setup
│   └── node.ts             # 新增: MSW node setup
├── e2e/                    # 新增: Playwright 测试
│   ├── playwright.config.ts
│   ├── homepage.spec.ts
│   └── search.spec.ts
└── package.json            # 修改: 添加依赖
```

---

### Task 1: TanStack Query 集成

**Files:**

- Create: `frontend/lib/query-client.ts`
- Modify: `frontend/app/layout.tsx`
- Modify: `frontend/package.json`

- [ ] **Step 1: 安装依赖**

```bash
cd frontend && pnpm add @tanstack/react-query
```

- [ ] **Step 2: 创建 query-client.ts**

```typescript
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
```

- [ ] **Step 3: 修改 layout.tsx 添加 Provider**

在 `frontend/app/layout.tsx` 添加：

```typescript
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: 测试构建**

```bash
cd frontend && pnpm build
```

- [ ] **Step 5: 提交**

```bash
git add frontend/lib/query-client.ts frontend/app/layout.tsx frontend/package.json pnpm-lock.yaml
git commit -m "feat: add TanStack Query for API state management"
```

---

### Task 2: MSW 集成

**Files:**

- Create: `frontend/mocks/handlers.ts`
- Create: `frontend/mocks/browser.ts`
- Modify: `frontend/package.json`

- [ ] **Step 1: 安装依赖**

```bash
cd frontend && pnpm add -D msw
```

- [ ] **Step 2: 初始化 MSW**

```bash
cd frontend && npx msw init public/ --save
```

- [ ] **Step 3: 创建 handlers.ts**

```typescript
import { http, HttpResponse } from "msw";

export const handlers = [
  http.get("http://localhost:8000/api/posts", () => {
    return HttpResponse.json({
      items: [
        {
          id: 1,
          title: "Mock Post",
          slug: "mock-post",
          excerpt: "This is a mock post",
          published: true,
          created_at: "2024-01-01T00:00:00Z",
          category: { id: 1, name: "Tech" },
          tags: [],
        },
      ],
      pagination: { total: 1, page: 1, limit: 10, total_pages: 1 },
    });
  }),

  http.get("http://localhost:8000/api/categories", () => {
    return HttpResponse.json([{ id: 1, name: "Tech" }]);
  }),

  http.get("http://localhost:8000/api/tags", () => {
    return HttpResponse.json([{ id: 1, name: "react" }]);
  }),

  http.get("http://localhost:8000/api/posts/:slug", () => {
    return HttpResponse.json({
      id: 1,
      title: "Mock Post",
      slug: "mock-post",
      content: "# Hello\n\nThis is mock content",
      excerpt: "Mock excerpt",
      published: true,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
      category_id: 1,
      category: { id: 1, name: "Tech" },
      tags: [{ id: 1, name: "react" }],
    });
  }),
];
```

- [ ] **Step 4: 创建 browser.ts**

```typescript
import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

export const worker = setupWorker(...handlers);
```

- [ ] **Step 5: 在开发环境启用 MSW (可选)**

在 `frontend/app/layout.tsx` 开发模式启用：

```typescript
import { useEffect, useState } from "react";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [mswReady, setMswReady] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      import("../mocks/browser").then(({ worker }) => {
        worker.start({ onUnhandledRequest: "bypass" }).then(() => setMswReady(true));
      });
    } else {
      setMswReady(true);
    }
  }, []);

  if (!mswReady) return null;

  return (
    // ... rest of layout
  );
}
```

- [ ] **Step 6: 提交**

```bash
git add frontend/mocks frontend/public/mswServiceWorker.js frontend/package.json pnpm-lock.yaml
git commit -m "feat: add MSW for API mocking"
```

---

### Task 3: Playwright E2E 测试

**Files:**

- Create: `frontend/e2e/playwright.config.ts`
- Create: `frontend/e2e/homepage.spec.ts`
- Create: `frontend/e2e/search.spec.ts`
- Modify: `frontend/package.json`

- [ ] **Step 1: 安装依赖**

```bash
cd frontend && pnpm add -D @playwright/test
```

- [ ] **Step 2: 安装浏览器**

```bash
cd frontend && npx playwright install chromium
```

- [ ] **Step 3: 创建 playwright.config.ts**

```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
});
```

- [ ] **Step 4: 创建 homepage.spec.ts**

```typescript
import { test, expect } from "@playwright/test";

test("homepage loads and shows posts", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/X-Blog/);
  await expect(page.locator("h1")).toContainText("最新文章");
});

test("navigation works", async ({ page }) => {
  await page.goto("/");
  await page.click("text=关于");
  await expect(page).toHaveURL("/about");
});
```

- [ ] **Step 5: 创建 search.spec.ts**

```typescript
import { test, expect } from "@playwright/test";

test("search functionality", async ({ page }) => {
  await page.goto("/");

  const searchInput = page.locator('input[placeholder="搜索文章..."]');
  await searchInput.fill("test");
  await searchInput.press("Enter");

  await expect(page).toHaveURL(/\/search\?q=test/);
  await expect(page.locator("h1")).toContainText("搜索结果");
});
```

- [ ] **Step 6: 添加 test:e2e 脚本**

在 `frontend/package.json` 添加：

```json
"test:e2e": "playwright test"
```

- [ ] **Step 7: 提交**

```bash
git add frontend/e2e frontend/package.json pnpm-lock.yaml
git commit -m "test: add Playwright E2E tests"
```

---

## 验证

完成所有任务后：

1. 后端测试
2. 前端测试
3. 前端构建
4. E2E 测试（可选，需要后端运行）

```bash
cd /var/tmp/aurora && just test
cd frontend && pnpm build
# cd frontend && pnpm test:e2e
```

(End of plan - 18 steps)
