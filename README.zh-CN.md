# X-Blog

<div align="center">

![Nuxt](https://img.shields.io/badge/Nuxt-4-0F172A?style=for-the-badge&logo=nuxt)
![FastAPI](https://img.shields.io/badge/FastAPI-0.135-009989?style=for-the-badge&logo=fastapi)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?style=for-the-badge&logo=typescript)
![Python](https://img.shields.io/badge/Python-3.14-3776AB?style=for-the-badge&logo=python)

现代化的全栈博客系统，基于 FastAPI + Nuxt 构建

[English](./README.md) · [中文](./README.zh-CN.md)

</div>

## ✨ 特性

- 🚀 **现代技术栈** - Nuxt 4, FastAPI, Vue 3, TypeScript, Python 3.14
- 📝 **Markdown 支持** - 支持 Mermaid 图表、KaTeX 数学公式、代码高亮
- 💬 **评论实时预览** - 评论表单通过"撰写/预览"切换，用与评论列表完全相同的净化 Markdown 管线渲染你的草稿，所见即所发（DEC-306）
- 🖼️ **评论图片灯箱** - 点击评论内的图片会打开与文章图片相同的全屏查看器，方向键浏览该评论自己的图片集（DEC-308）
- 🖼️ **图片灯箱** - 点击任意文章图片（Markdown 或 HTML）进入全屏、原始分辨率查看器，支持方向键浏览、ESC/背景/按钮关闭，焦点自动归还（DEC-302）
- 🎨 **精美 UI** - Tailwind CSS v4 构建
- 📱 **响应式设计** - 完美适配移动端
- 🔒 **管理后台** - 内置内容管理后台
- 🧪 **完善测试** - 2500+ 个测试 (后端 1243 + Nuxt 前端 1317), 后端覆盖率 93.5%
- ✅ **类型安全** - 完整 TypeScript 支持 + Pydantic 验证
- 🔍 **全文搜索** - 文章搜索 + 评论搜索（`/search` 的「评论」模式，round 366）
- 💬 **最新讨论流** - `/discussion` 公开页按时间倒序浏览全站最新已审核评论：每张卡片带评论者身份、内容与帖子简介，点击即可深链跳到对应文章里的那条评论（round 367）
- 📡 **讨论 RSS/Atom** - 讨论不仅能找（round 366）、能逛（round 367），还能订阅：`/rss/comments.xml`（RSS 2.0）与 `/rss/comments.atom.xml`（Atom）流式推送全站最新已审核评论，每条条目携带评论者 + 帖子标题并深链到具体那条评论，`/discussion` 页上提供订阅链接与自动发现标签（round 368）
- 🔍 **我的评论关键字搜索** - 评论历史很长的读者，现在可以按正文找到想找的那一条：「我的评论」页新增带防抖的回忆式搜索框，`GET /api/reader/me/comments` 新增可选 `q` 参数按评论正文匹配（已转义、可与状态筛选叠加）——在后端执行，因此覆盖全部历史而非仅当前加载页（round 369）
- 🌙 **深色模式** - 跟随系统偏好的深色模式
- 📊 **阅读统计** - 浏览量、点赞数、阅读进度
- 💬 **评论系统** - 支持楼中楼回复
- 🏷️ **标签分类** - 使用标签和分类组织文章
- 📚 **文章系列** - 将文章组织为有序的多篇系列，支持系列内上一篇/下一篇导航，并可在文章页就地关注当前系列、接收新篇通知（DEC-290）
- ✍️ **关注作者** - 在多人协作的博客上，读者因喜欢某位作者的文章而想单独关注这个人：每篇文章的署名旁、以及作者的公开归档页 `/authors/{id}` 顶部都有关注按钮，每篇文章页还有「{作者} 的更多文章」模块让读者在原地发现这位作者的其他作品，该作者每发布一篇新文章都会以站内通知记录 + Web Push 推送给关注者——按主题的分类/系列/标签关注无法表达这种「人」形诉求（round 353 / 355 / 356）
- 📝 **作者简介** -「人」形作者面终于能为自己发声：超级管理员在管理后台的用户管理里（笔名旁边）设置一段简短的公开「关于这位作者」文字（与读者简介相同的 500 字纯文本上限），它会渲染在作者 `/authors/{id}` 归档页的名称下方——并在 `/authors` 索引卡片上显示一行——让读者在决定是否关注这位作者时，真正了解这个人，而不只是看过他的作品（round 357）
- 🖼️ **作者头像** -「人」形作者面如今也有了面孔：超级管理员可以在用户管理里（笔名旁）上传一张小型头像（与读者头像相同的校验、压缩管线与 `static/avatars` 存储，前者见 DEC-299），它会渲染在作者的每一处公开展示——文章卡片署名、文章页署名、「该作者的其他文章」模块、`/authors` 索引卡片以及归档页头部——读者一眼就能认出某位作者，而不是一个通用的用户图标（round 358）
- 📰 **关注流** - 已登录读者可在 `/follows` 分页浏览其关注的分类、系列、标签与作者下的所有新文章（突破首页 12 篇封顶），有作者署名的卡片会显示笔名，首页还提供"查看全部"入口（DEC-292，作者维度 round 354）
- 🔖 **云端收藏同步** - 读者账号让收藏跨设备同步（登录后本地收藏自动合并到云端）
- 📚 **收藏「待读 / 已读」队列** - 已保存的文章要么在待读队列里，要么已标记为已读（round 361）：`/bookmarks` 页面提供「全部 / 待读 / 已读」筛选行（带实时计数）和每行的切换按钮，「存着以后读」不再与「已经读完想留着」混为一谈——该状态与收藏本身一样支持云端同步
- ❤️ **云端同步的点赞与喜欢列表** - 已登录读者的点赞是持久的跨设备云端记录（round 359）：文章页爱心变真正开关（再点一下取消并递减计数）、登录前点的赞在登录时提升为云端记录、新的带鉴权 `/liked` 页面（「我欣赏的文章」视图，与收藏和阅读历史并列）挂载时合并服务器喜欢集——一台设备点的赞在另一台设备也出现；`/liked` 还新增带防抖的回忆式搜索框（round 370，`GET /api/reader/me/likes?q=` 匹配标题/摘要），喜欢了很多文章的读者也能找到那篇现在才想起来的那篇，并支持在卡片上一键取消喜欢（round 371）——无需回到文章页就能把赞收回来
- 👥 **公开「喜欢的文章」主页标签** - 第一个读者对读者的发现界面（round 360）：读者可在 `/account` 选择公开（默认关闭）后在公开的 `/readers/{id}` 主页发布「喜欢的文章」标签页，任何人无需登录即可浏览其点赞的文章。默认关闭，读者不主动分享则点赞始终是私密喜好；未开启的读者没有任何标签页与公开接口（无可泄露内容）
- 🏷️ **公开「收藏的文章」主页标签** - 第二个可选公开的发现界面（round 363）：在「喜欢的文章」标签页之外，读者还可在 `/account` 开启（默认关闭，与点赞开关相互独立）后在公开的 `/readers/{id}` 主页发布「收藏的文章」标签页，列出 TA 选择保留的文章——任何人无需登录即可浏览。读者的阅读清单不主动分享则始终私密；从未开启的读者没有该标签页，公开接口与「读者不存在」一样返回 404（无可泄露内容）
- 👥 **读者互相关注** - 最后一个无法被关注的身份终于闭环（round 365）：在公开主页 `/readers/{id}` 上，已登录读者可以关注署名背后的这位评论者——「关注作者」的读者版对应物——只要 TA 通过审核的评论一发布，就会有一条第深链的站内通知记录；`/notifications` 上还提供按类型的一键关闭开关。每位访客都能看到粉丝数；访客只有数字、无操作按钮，看自己的主页隐藏按钮，`/account` 列出已关注的读者，可一键取消关注（取消后即停止推送）
- 📖 **跨设备续读位置** - 已登录读者回到文章时从上一次离开的地方继续：文章页在服务端记住滚动位置（DEC-167），并把位置同时存成可滚动高度的比例，手机↔桌面之间继续阅读落在同一处（DEC-346）；首页"继续阅读"行对已登录读者直接取这条服务端记录，换任何设备都能看到上次没读完的文章（DEC-348）
- 🔐 **读者两步验证（TOTP）** - 读者可在 `/account` 开启两步验证（扫描二维码 / 备份 base32 密钥，再用密码 + 一个验证码确认），此后每次登录在输入密码后都需要输入身份验证器 App 的 6 位验证码；关闭同样需要密码 + 验证码（round 364）：读者账号保管着大量持久私密数据（云端同步的收藏/点赞/阅读历史、GDPR 导出），仅凭泄露的密码已不足以完整接管账号
- 📈 **读者本地的连续阅读与热力图** - `/history` 的阅读连续与 52 周活跃热力图按"你的"日历而不是服务器日历计天数：页面随请求声明浏览器时区，后端按你的本地时区对阅读分桶（并把"今天"锚定到你的本地日）——无论你身在何处，晚上的阅读都算作今天（DEC-316）；阅读洞察面板（round 372，`GET /api/reader/me/history/insights`）补上「读了什么 / 读了多少」——全部与近 30 天读过的文章数，以及常读分类
- ✨ **文章页「猜你喜欢」** - 首页的亲和度推荐（DEC-128）如今也出现在每篇文章末尾，面向已登录读者（round 362）：读完一篇文章后，「接下来读什么？」这个意图最强的时刻不再只给话题相似的相关文章，而是按读者自己的阅读历史/收藏亲和度推荐——访客与没有亲和度的新读者什么都不会看到
- 💬 **我的评论管理** - 已登录读者可查看自己评论的审核状态（待审核 / 已发布 / 未通过）并可删除（DEC-066）；"在文章上"跳转深链到具体评论而非文章标题（DEC-321）
- 🪪 **读者公开主页** - 已登录读者在文章里通过审核的评论，其显示名可点击直达公开主页 `/readers/{id}`（展示显示名、加入时间与已通过评论，无需登录）；未知 id 显示"读者不存在"（DEC-294）
- 🖼️ **读者头像** - 读者可在 `/account` 设置个人头像（上传或移除）；它会渲染在公开主页与每条评论旁已认证名字的边上，未设置时回退为首字母占位（DEC-299）
- 📝 **读者个人简介** - 读者可在 `/account` 写一小段「关于我」（纯文本、上限 500 字），它会在公开的 `/readers/{id}` 主页上显示在显示名之下，让头像、连续记录、已通过评论之外的身份面更完整（round 352）
- 🎯 **SEO 优化** - Open Graph、JSON-LD 结构化数据，以及覆盖全部已发布文章（无上限）、每个系列（DEC-318）、每个已发布静态页面 `/pages/{slug}` 与每位已设笔名作者的归档 `/authors/{id}` 的完整站点地图——页面写入会使 feed 缓存失效，因此一经发布便立即进入站点地图（round 348）
- ⬆️ **文章置顶** - 将重要文章置顶显示
- 📤 **数据导出** - 导出文章/评论为 CSV；登录读者可下载完整的 GDPR 式"我的数据"压缩包（资料、收藏、评论、历史、关注、通知偏好、收件箱记录、推送设备——DEC-126 / DEC-334）
- 🗓️ **内容日历** - 管理员在月历上一眼查看发布计划——已发布 / 定时发布 / 草稿按日期展示，点击即可进入编辑器（DEC-162）
- 🔀 **别名变更跳转** - 为文章、系列或静态页面重设别名永远不会让旧 URL 失联：每个此前分享过的链接（分享链接、搜索结果、RSS、收藏）都会以永久 301 跳转到规范的新别名——爬虫保住链接权重，反复改名也会坍缩，A→B 再 B→C 一步到位 A→C（round 350）
- 🔒 **单篇文章评论开关** - 高噪音或涉及隐私的文章可直接在编辑器里关闭评论，不必删掉对话、也不影响全站：公开页保留已有评论串，但用「评论已关闭」提示替换评论表单，API 也明确以 403 拒绝新评论（round 351）
- 📋 **复制文章** - 编辑重复形状的内容（周报、发布说明、系列章节模板）时，可直接在文章列表一键把某篇文章复制成一篇新草稿：正文 + 分类法 + 署名原样保留，生成新的唯一别名，并清空全部发布元数据（未发布、未定时、未置顶、阅读/点赞归零）——一份绝不会外泄或自行通告的私有模板（round 349）
- 📡 **RSS & Atom 订阅** - 可订阅全站源，也可按分类/标签订阅定向源，并支持自动发现（DEC-074）；标签范围源经 Nuxt 源站保持限定（DEC-314）
- 🔔 **新文章推送通知** - 关注某个分类（或全部新文章），作者发布时通过浏览器推送提醒你（DEC-076）
- ⏰ **定时文章上线通知** - 以"已发布但 publish_at 在未来"方式保存的文章（编辑日历）在真正上线的那一刻自动通告：其系列/分类/标签的关注者各收到恰好一条新文章通知（收件箱 + 推送 + 开启邮件的也收邮件），由该文章上线后的第一次公开读取触发——覆盖展示该文章的每一个展面（列表、详情、`/follows`、搜索、RSS/Atom、sitemap），即使多 worker 并发也保证恰好一次（DEC-336 / DEC-344）
- 🌐 **读者语言的通知文案** - 登录读者的收件箱标题、通知邮件与每周精选邮件按其选择的语言（en 或 zh）渲染——语言切换器会把选择同步到账号，英文读者切换后立即告别「系列更新 / 新文章发布」的中文行与中文邮件；覆盖全部类型（新文章、回复、订阅的讨论、@提及）与每周精选；从未切换的读者保持原有中文文案（DEC-338 / DEC-340）
- 💬 **评论讨论订阅** - 订阅某篇文章的评论讨论，新评论通过审核后通过浏览器推送提醒你（DEC-078）
- 🔔 **读者通知中心** - 已登录读者可在站内查看（已读/未读）关注系列/分类的新文章、他人对自己评论的回复、所订阅讨论的新评论、以及评论中对某位读者显示名的 @提及——即使错过浏览器推送或未开启 Web Push 也能看到（DEC-160）
- 🏷️ **@提及通知** - 评论中 @ 提到某位读者的显示名（如「@Riki」）时，评论通过审核后该读者会收到收件箱通知并深链到那条评论；按词边界匹配，且「被提及」类型默认开启、可单独关闭（DEC-322）
- ⌨️ **@提及自动补全** - 评论框输入「@」会弹出匹配读者的候选列表（公开 suggest 接口，前缀优先、结果有界）；点选后在光标处插入「@名字 」，真正通知到对方（DEC-324）
- 🔕 **分类通知偏好** - 已登录读者可在通知中心页面单独关闭某类通知（新文章 / 收到回复 / 订阅的讨论 / 被提及）；关闭后该类型在每一个分发点都不会再产生站内条目或浏览器推送（DEC-171）
- 🗑️ **删除收件箱通知** - 已登录读者可在通知中心删除任意一条已消费通知，让持久化的收件箱（否则会无限累积）保持整洁（DEC-312）
- 📧 **邮件通知 + 每周精选** - 已登录读者可开启邮件通道：按事件逐封发送（新文章 / 回复 / 讨论新评论 / 被@提及），或开启「每周精选」每周收到一封汇总本周新文章的邮件——都能在通知中心页面直接开关（DEC-197 / DEC-201 / DEC-326）
- 🌏 **站点语言的访客与找回邮件** - 访客回复邮件与密码重置邮件按站点配置的语言（`SITE_LANGUAGE`）与站点名（`SITE_TITLE`）渲染，配置为英文的站点绝不会再发出中文或站名错误的邮件（DEC-342）
- 📧 **访客邮件订阅** - 页脚提供「新文章邮件提醒」入口：任意访客输入邮箱、点开站务发送的双重确认链接后，每篇新发布的文章都会收到一封邮件（深链到文章），邮件自带该订阅专属的退订链接；订阅成功与否对外永远返回同一条消息（无邮箱存在性探测），定时发布的文章同样恰一次触达（DEC-351）
- 📧 **管理员订阅者管理** - 管理后台提供订阅者列表（邮箱、已确认/待确认标签、订阅日期），支持状态筛选、不区分大小写的邮箱搜索、分页与逐行移除（彻底删除该订阅及其 token）；被他人代订、邮箱失效或丢失退订 token 的地址如今都能被真正处理（DEC-354）
- 📧 **订阅者每周摘要** - 访客订阅者可以选择每周收到一封汇总邮件，而不是每篇新文章都收到一封（订阅时勾选，或确认页切换）：选择每周摘要的订阅者不再收到逐篇邮件，改为每周收到一封按站点语言渲染的汇总邮件，页脚仍带各自的 token 退订链接——读者账号早已拥有的周报，如今也开放给访客（DEC-355）
- ✉️ **修改登录邮箱** - 换了邮箱地址的读者可以在 `/account` 更换登录邮箱（新邮箱 + 当前密码）：后端会向**新**邮箱发送一封一次性验证邮件（60 分钟内有效，重复发起会替换待处理中的变更），打开该链接即完成切换——邮箱替换、token 版本递增（吊销此前的所有会话）并自动用新邮箱登录——再也不用被困在失效邮箱上，且任何接口都不会泄露某地址是否属于某个账号（DEC-357）
- ✍️ **作者署名与归档页** - 多编辑博客的每篇文章如今都会标明作者：管理员可设置公开笔名（刻意与登录用户名区分开——管理员登录不做名册泄露防护，用户名绝不外泄），该署名会出现在文章页与每一张列表卡片上，并链接到 `/authors/{id}`；作者归档页只列出该作者已发布的文章，即使暂无文章也按笔名显示标题。文章编辑器的作者选择器还允许任意管理员把某篇文章署给另一位已设笔名的作者（或保持默认「我」）（DEC-359, TASK-406）；每位作者还有专属 RSS 订阅源——`/authors/{id}`
  提供自动发现与订阅链接指向 `/rss/authors/{id}.xml`（round 345）；`/authors` 现在也是作者索引页——每位已设笔名的作者一张卡片，带已发布文章数，点击进入其归档（round 346）
- 📑 **静态页面 CMS** - 自托管博客应当能为自己发声（隐私政策、条款、联系、变更日志），但唯一的静态页面却是一个写死的 `/about`。如今管理员可以在专门的「页面」管理器中，把经过整理标注的 Markdown 页面发布到 `/pages/{slug}`（标题 + 自动别名 + Markdown 正文 + 发布开关；行内编辑、发布/下架、确认后删除）；未发布或未知的别名返回与不存在相同的 404（无法枚举草稿），已发布页面还会出现在站点页脚，无需改代码部署即可被发现（round 347）
- 📧 **访客回复邮件** - 匿名评论者勾选「有人回复我的评论时邮件通知我」后，他们的评论收到被审核通过的回复时会收到一封邮件（深链到该回复，并附带可用的退订链接）——读者拥有的离站通道现在也照顾客人必须留下的邮箱（DEC-332）
- 🖼️ **媒体库** - 管理员可浏览所有已上传图片（网格、预览、复制链接、使用中标记），删除未被任何文章引用的上传（被引用的图片会由后端拒绝删除），并可直接从编辑器工具栏插入之前上传的图片（DEC-183）

## 🚀 快速开始

### 环境要求

| 工具    | 版本  | 安装方式                              |
| ------- | ----- | ------------------------------------- |
| Python  | 3.14+ | [uv](https://github.com/astral-sh/uv) |
| Node.js | 24+   | [Node.js](https://nodejs.org/)        |
| pnpm    | 10+   | `npm install -g pnpm`                 |
| just    | 1.0+  | [just](https://github.com/casey/just) |

```bash
# 安装 uv (Python 包管理器)
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 安装

```bash
# 安装所有依赖
just install

# 或者手动安装:
cd backend && uv sync
cd frontend/aura && pnpm install
```

### 开发

```bash
# 运行后端和前端
just dev

# 或者分别运行:
just backend  # http://localhost:18888
just frontend # http://localhost:34567
```

### 🐳 Docker 部署

```bash
# 克隆并启动
git clone https://github.com/pplmx/x-blog.git
cd x-blog

# 配置环境变量
cp backend/.env.example backend/.env

# 使用 Docker Compose 启动
docker-compose up -d

# 查看日志
docker-compose logs -f
```

详细部署指南见 [docs/deployment.md](./docs/deployment.md)

## 🛠️ 命令

| 命令                 | 说明                         |
| -------------------- | ---------------------------- |
| `just install`       | 安装所有依赖                 |
| `just dev`           | 运行开发服务器 (后端 + 前端) |
| `just backend`       | 运行 FastAPI 后端            |
| `just frontend`      | 运行 Nuxt 前端               |
| `just lint`          | 代码检查 (ruff)              |
| `just format`        | 代码格式化                   |
| `just test`          | 运行所有测试 (后端 + Nuxt)   |
| `just test-backend`  | 运行后端测试 (并行)          |
| `just test-frontend` | 运行 Nuxt 前端测试           |
| `just fix`           | 自动修复代码问题             |
| `just ci`            | 运行 lint + format + test    |
| `just clean`         | 清理生成文件                 |

## 📡 API 接口

### 文章

| 方法   | 路径                      | 说明               |
| ------ | ------------------------- | ------------------ |
| GET    | `/api/posts`              | 获取文章列表       |
| GET    | `/api/posts/{slug}`       | 根据 slug 获取文章 |
| GET    | `/api/posts/{id}/related` | 获取相关文章       |
| POST   | `/api/posts`              | 创建文章           |
| PUT    | `/api/posts/{id}`         | 更新文章           |
| DELETE | `/api/posts/{id}`         | 删除文章           |
| POST   | `/api/posts/{id}/like`    | 点赞文章           |
| POST   | `/api/posts/{id}/view`    | 增加浏览量         |

### 系列

| 方法   | 路径                   | 说明                                     |
| ------ | ---------------------- | ---------------------------------------- |
| GET    | `/api/series`          | 获取公开系列列表（含文章数）             |
| GET    | `/api/series/{slug}`   | 获取系列详情（按作者顺序的已发布文章）   |
| POST   | `/api/series`          | 创建系列（管理员）                       |
| PUT    | `/api/series/{id}`     | 更新系列（管理员）                       |
| DELETE | `/api/series/{id}`     | 删除系列，解除文章关联（管理员）         |

系列将文章组织为作者可控顺序的序列（`Post.series_id` + `Post.series_order`）；系列详情页按该顺序渲染，系列内文章显示系列标签并提供上一篇/下一篇导航。

### 评论（需审核）

| 方法   | 路径                         | 说明                                 |
| ------ | ---------------------------- | ------------------------------------ |
| GET    | `/api/comments/post/{id}`    | 获取已审核评论                       |
| POST   | `/api/comments/post/{id}`    | 发表评论                             |
| DELETE | `/api/comments/{id}`         | 删除评论 (管理员)                    |
| PATCH  | `/api/comments/{id}/approve` | 审核通过/拒绝                        |
| GET    | `/api/readers/{id}`          | 读者公开主页 + 已通过评论（DEC-294） |

评论需审核后可见。**已登录读者**以账号身份发表评论（DEC-062）：表单省略
昵称/邮箱，后端盖章账号昵称（客户端伪造的身份一律忽略，杜绝冒名），评论区显示
“已认证读者”徽标；匿名评论者仍走自由填写的昵称/邮箱路径。**我的评论**页面
（DEC-066，`/comments`）向本人展示全部评论及其审核状态（待审核 / 已发布 /
未通过），并可删除自己的评论（`GET /api/reader/me/comments` 支持可选 `q`
正文关键字筛选，已转义、可与状态筛选叠加，
`DELETE /api/reader/me/comments/{id}`）。**账号设置**页面（DEC-067，`/account`）
允许读者修改显示名、设置/移除个人头像（DEC-299，`POST /api/reader/me/avatar`、
`DELETE /api/reader/me/avatar`）、修改密码（验证当前密码、登出其他会话、签发新
token）、更换登录邮箱（DEC-357：填新邮箱 + 当前密码，向新邮箱发送一次性验证链接，
打开后切换邮箱、吊销此前会话并自动登录，
`POST /api/reader/me/email/request`、`POST /api/reader/me/email/confirm`），
并查看/移除绑定到账号的推送设备。

### 管理后台

| 方法 | 路径                                | 说明                                      |
| ---- | ----------------------------------- | ----------------------------------------- |
| POST | `/api/admin/login`                  | 管理员登录                                |
| GET  | `/api/admin/stats`                  | 仪表盘统计                                |
| GET  | `/api/posts?all=true`               | 列出全部（含草稿）                        |
| GET  | `/api/comments?approved=false`      | 待审核评论列表                            |
| POST | `/api/upload`                       | 上传图片                                  |
| GET  | `/api/export/posts.csv`             | 导出文章                                  |
| GET  | `/api/export/comments.csv`          | 导出评论                                  |
| GET  | `/api/admin/calendar?month=YYYY-MM` | 按日期聚合的文章，用于内容日历（DEC-162） |

### 搜索、SEO 与统计

| 方法 | 路径                      | 说明                                                    |
| ---- | ------------------------- | ------------------------------------------------------- |
| GET  | `/api/search?q=`          | 全文搜索（中文感知，DEC-070）                           |
| GET  | `/api/search/comments?q=` | 评论搜索——已审核评论 + 高亮片段与帖子简介（DEC-405）    |
| GET  | `/api/comments/feed`      | 最新讨论流——全站最新已审核评论 + 帖子简介（DEC-407）    |
| GET  | `/rss/comments.xml`       | 讨论 RSS——全站最新已审核评论，深链到每条评论（DEC-409） |
| GET  | `/rss/comments.atom.xml`  | 讨论 Atom——全站最新已审核评论（DEC-409）                |
| GET  | `/api/stats`              | 博客统计                                                |
| GET  | `/rss/feed.xml`           | RSS 2.0 订阅源                                          |
| GET  | `/rss/atom.xml`           | Atom 订阅源                                             |
| GET  | `/sitemap.xml`            | XML 站点地图                                            |
| GET  | `/robots.txt`             | robots.txt                                              |
| GET  | `/health`                 | 健康检查                                                |

### 读者账号与云端收藏

读者账号是云端收藏同步的 identity 层（与 admin JWT 通过 `aud` 严格隔离，见
`docs/security.md`）；注册默认限流 5/min/IP。

| 方法   | 路径                                      | 说明                                                                             |
| ------ | ----------------------------------------- | -------------------------------------------------------------------------------- |
| POST   | `/api/reader/register`                    | 创建读者账号（返回读者 JWT，自动登录）                                           |
| POST   | `/api/reader/login`                       | 读者登录（邮箱 + 密码）                                                          |
| GET    | `/api/reader/me`                          | 当前读者资料                                                                     |
| GET    | `/api/reader/me/bookmarks`                | 云端收藏列表（仅公开可见的文章；可带 `folder_id` 与 `done` 队列筛选）            |
| PUT    | `/api/reader/me/bookmarks/{id}`           | 添加收藏（幂等：新建 201 / 已存在 200）                                          |
| PATCH  | `/api/reader/me/bookmarks/{id}/done`      | 在「待读 / 已读」之间切换（幂等；未收藏返回 404）（DEC-395）                     |
| DELETE | `/api/reader/me/bookmarks/{id}`           | 移除收藏（幂等 204）                                                             |
| GET    | `/api/reader/me/comments`                 | 读者自己的评论历史（分状态），支持可选 `q` 正文关键字筛选（DEC-062；q：DEC-411） |
| GET    | `/api/reader/me/notifications`            | 读者的持久通知中心（已读/未读）（DEC-160）                                       |
| POST   | `/api/reader/me/notifications/{id}/read`  | 将某条通知标为已读（DEC-160）                                                    |
| POST   | `/api/reader/me/notifications/read-all`   | 将全部通知标为已读（DEC-160）                                                    |
| GET    | `/api/reader/me/notification-preferences` | 读取读者各类通知开关（DEC-171）                                                  |
| PATCH  | `/api/reader/me/notification-preferences` | 切换某一类通知开关（DEC-171）                                                    |

收藏在浏览器端以 localStorage 为主，登录时合并到云端——离线操作不丢失，下次
登录时自动对账。读者收藏数据不出现在共享缓存（`Cache-Control: no-store`）。

**读者通知中心（DEC-160）**：`/notifications` 为已登录读者展示其持久化、
带已读/未读状态的关注/回复/讨论动态列表——关注系列/分类的新文章、他人对自己
评论的回复、以及所订阅讨论的新评论——每条都可深链到来源。这些记录在与浏览器
推送相同的触发点写入服务端，因此即使错过推送或关闭 Web Push，读者也能看到。

### Web Push 与回复通知（可选，需 VAPID keys）

`POST /api/push/subscribe`（携带读者 JWT 时）把浏览器订阅绑定到读者账号
（DEC-064）：有人回复该读者的评论时，推送"有人回复了你的评论"通知；匿名
订阅者仍只接收管理员广播。未配置 `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` 时
所有 push 端点 fail-closed 返回 503。回复通知文案可通过
`REPLY_NOTIFICATION_TITLE`/`REPLY_NOTIFICATION_BODY` 覆盖。

## 🏗️ 系统架构

![架构图](./docs/x-blog-architecture.png)

> 📁 [交互式 HTML 版本](./docs/x-blog-architecture.html) — 本地浏览器打开可缩放查看。涵盖：Nuxt 前端、FastAPI 后端、SQLite 数据库、JWT 认证、管理后台、DevOps 工具链。

## 🗂️ 项目结构

```text
x-blog/
├── backend/                 # FastAPI 后端
│   ├── app/
│   │   ├── main.py         # 应用入口
│   │   ├── config.py       # 配置
│   │   ├── database.py     # 数据库连接
│   │   ├── models.py       # SQLAlchemy 模型
│   │   ├── schemas.py      # Pydantic schemas
│   │   ├── crud.py         # 数据库操作
│   │   └── routers/        # API 路由
│   ├── tests/              # pytest 测试 (1243 个)
│   └── pyproject.toml      # Python 配置
│
├── frontend/
│   └── nuxt/               # Nuxt 4 应用 (Vue 前端)
│       ├── app/            # 页面、布局
│       ├── components/     # Vue 组件
│       ├── composables/    # Composables (useApi, useI18n 等)
│       ├── server/         # 服务端路由 (RSS, sitemap 等)
│       ├── tests/          # 单元测试
│       ├── e2e/            # E2E 测试
│       ├── package.json
│       └── Dockerfile
├── docs/                   # 文档
├── justfile                # 任务运行器 (推荐)
└── package.json            # 根目录配置 (pnpm workspaces)
```

## 🧰 技术栈

### 后端

- **框架**: [FastAPI](https://fastapi.tiangolo.com/) - 现代 Python Web 框架
- **ORM**: [SQLAlchemy](https://www.sqlalchemy.org/) - 数据库 ORM
- **数据库**: SQLite (默认)，可轻松切换到 PostgreSQL/MySQL
- **验证**: [Pydantic](https://docs.pydantic.dev/) - 数据验证
- **测试**: [pytest](https://pytest.org/) - Python 测试框架，支持 pytest-xdist 并行执行
- **代码检查**: [ruff](https://docs.astral.sh/ruff/) - 快速的 Python linter 和格式化工具

### 前端

- **框架**: [Nuxt 4](https://nuxt.com/) - Vue 框架，支持 SSR/SSG
- **UI**: 自定义 Vue 组件 + Tailwind CSS
- **样式**: [Tailwind CSS v4](https://tailwindcss.com/) - CSS 框架
- **测试**: [Vitest](https://vitest.dev/) - 单元测试, [Playwright](https://playwright.dev/) - E2E 测试
- **图标**: [@iconify/vue](https://icon-sets.iconify.design/) + lucide 图标

### 开发工具

- **包管理**: [uv](https://github.com/astral.sh/uv) (Python), [pnpm](https://pnpm.io/) (Node.js)
- **任务运行**: [just](https://github.com/casey/just) - 命令运行器
- **代码检查**: [ruff](https://docs.astral.sh/ruff/) (Python)
- **Git Hooks**: [prek](https://github.com/astral-sh/prek) - Git hooks 管理器

## 🧪 测试

```bash
# 运行所有测试
just test

# 运行后端测试 (并行)
just test-backend

# 运行前端测试
just test-frontend

# 运行带覆盖率测试
just test-frontend-coverage
```

### 使用 PostgreSQL 测试

后端测试默认使用 SQLite。如需使用 PostgreSQL 进行测试：

```bash
# 运行后端测试 (PostgreSQL)
TEST_DATABASE_URL="postgresql://user:password@host:port/dbname" just test-backend-postgres

# 或直接使用 uv
TEST_DATABASE_URL="postgresql://user:password@host:port/dbname" uv run pytest -n auto
```

PostgreSQL 测试包含专门的连接验证测试 (`tests/test_postgres_connection.py`)，涵盖连接建立、模式创建、事务、CRUD 操作和并发连接等。

**测试统计:**

- 后端: 1243 个测试 (pytest + pytest-xdist), 93.5% 覆盖率
- 前端: 1317 个测试 (Vitest)
- **总计: 2523 个测试**

## 🤝 贡献

1. Fork 本项目
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 运行测试确保一切正常 (`just test`)
4. 修复任何代码问题 (`just fix`)
5. 使用[约定式提交](https://www.conventionalcommits.org/)提交更改
6. 推送分支 (`git push origin feature/amazing-feature`)
7. 提交 Pull Request

## 📄 许可证

MIT License - 查看 [LICENSE](LICENSE) 了解详情。

## 🚀 部署指南

详细部署指南见 [docs/deployment.md](./docs/deployment.md)：

- 本地开发环境搭建
- Docker 生产部署
- 分离后端/前端部署
- 环境配置

---

<div align="center">

使用 ❤️ 基于 FastAPI + Nuxt 构建

</div>
