# 顶栏收敛 + 「我的」头像菜单 — 设计

日期：2026-09-18
状态：已批准（方案 A + 通知入「我的」）

## 背景与问题

顶栏（`frontend/aura/app/layouts/default.vue`）当前平铺导航日益膨胀：

- **登录后（英文）共 14 个链接**：首页·关于·作者·分类·系列·归档·搜索 + 收藏·历史·我的评论·喜欢·关注·通知·账号，外加搜索框、推送订阅、退出、语言、主题切换。
- 代码注释自述：完整链接集在签名读者下需要 **1400px+**；更窄时只能隐藏滚动条横向滚动（`flex-justify-end` 等历史坑已修）。
- **登录态宽度跳变**：未登录 10 链接 → 登录 14 链接，布局不稳定。

根本问题是顶栏混了两类职责：
1. **内容浏览类**（公开）：首页·关于·作者·分类·系列·归档·搜索 — 博客核心"发现内容"导航。
2. **读者个人类**：收藏·阅读历史·我的评论·喜欢·关注·通知·账号 — "回到我自己"的入口。

## 决策

- **方案 A**：读者个人类全部收敛进一个「我的」头像下拉菜单（GitHub / Medium / 豆瓣通用模式）。
- **通知** 放在「我的」菜单内，未读数以红点数字显示在头像上（不单独保留铃铛）。

关键论证：

1. 顶栏天然职责是"发现内容"；个人页是低频"回自己空间"入口，无需常驻。
2. 顶栏长度应**不随登录态变化**：登录只把「登录」按钮换成头像。
3. 可扩展性：未来新个人功能一律进入「我的」，顶栏不再膨胀。
4. **SSR/hydration 收益**：`default.vue` 现有"authOnly 链接必须追加在末尾，否则复用 SSR 节点致 href 串位"的历史约束（详见该文件注释）。收敛后 authOnly 只剩**一个尾节点**（头像），该约束从根上简化，注释可大幅精简。
5. 徽标不丢：`useNotificationBadge` 的红点/数字迁移到头像。

## 新顶栏结构

| 登录态 | 顶栏平铺 | 右侧固定档位 |
|--------|----------|--------------|
| 未登录 | 首页·关于·作者·分类·系列·归档·搜索框 | 订阅 · 登录 · 语言 · 主题 |
| 已登录 | 首页·关于·作者·分类·系列·归档·搜索框 | 订阅 · **头像** · 语言 · 主题 |

行为变更：未登录不再显示 收藏/历史/我的评论（原为空态登录引导入口，随登录态出现）。这些页面 URL 仍直达，空态逻辑照旧。

## 新组件 `ReaderMenu.vue`（"我的"下拉）

触发器：头像（`reader.avatar_url` 有则显示，否则默认用户图标）+ 未读红点数字徽标。
无障碍：`aria-haspopup="menu"`、`aria-expanded`；Escape 关闭并归还焦点到触发器；点击外部关闭。复用 `HeaderSearch` / 移动菜单（ISS-131）的既有键盘与焦点模式。

菜单项自顶向下：

1. 迷你资料头（头像 + `display_name` / email）→ `/account`
2. 查看公开主页 → `/readers/{reader.id}`
3. ─── 分割线 ───
4. 收藏 → `/bookmarks`
5. 阅读历史 → `/history`
6. 我的评论 → `/comments`
7. 喜欢的文章 → `/liked`
8. 我的关注 → `/follows`
9. 通知（带未读徽标） → `/notifications`
10. ─── 分割线 ───
11. 退出登录（复用 `logout`；`watch(isAuthenticated)` 自动停轮询）

## SSR/hydration 不变量

保持 `navLinks` 数组结构：公开链接在前，**唯一 authOnly 尾节点**（头像触发器）。移动菜单复用同一份配置：公开链接平铺 + 「我的」区块头分组（移动端竖向空间充足，不折叠）。

## 徽标逻辑

`useNotificationBadge` 原样保留：红点数字挂头像；菜单内「通知」项同样显示数字。登录起轮询 / 退出停轮询的 watch 逻辑保留（可移入 ReaderMenu）。

## 文案（en/zh 双语）

- 新增 `reader.nav.groupMy` = 我的 / My（移动端区块标题 + toggle aria-label）
- 新增 `reader.nav.viewMyProfile` = 查看主页 / View my profile
- 其余复用现有 `reader.nav.*`（bookmarks/history/comments/liked/follows/notifications/account/signOut）

## 测试

- 新增 `tests/components/ReaderMenu.spec.ts`：项渲染 / 徽标 / 外部点击 / Escape / 焦点归还
- 更新 `tests/layouts/default.spec.ts`：登录态差异（未登录见公开链接 + 登录、无个人链接；已登录头像在、个人项在菜单内）
- e2e：逐个核对依赖顶栏直达的用例（bookmarks / history / my-comments / liked / follows / notifications / account / reader-avatar 等），改为「打开我的菜单 → 点目标」

## 改动文件

| 文件 | 操作 |
|------|------|
| `frontend/aura/components/ReaderMenu.vue` | 新增 |
| `frontend/aura/app/layouts/default.vue` | 改（nav 配置 + 桌面/移动两处渲染接入 ReaderMenu） |
| `frontend/aura/locales/en/reader.json` | 改（新增 2 key） |
| `frontend/aura/locales/zh/reader.json` | 改（新增 2 key） |
| `frontend/aura/tests/layouts/default.spec.ts` | 改 |
| `frontend/aura/tests/components/ReaderMenu.spec.ts` | 新增 |
| `frontend/aura/e2e/*` | 按需更新受影响的导航用例 |
