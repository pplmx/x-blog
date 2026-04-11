# X-Blog 评论系统设计

**日期**: 2026-04-12  
**状态**: 已批准

## 1. 功能

- 无需登录，任何人可评论
- 完整评论信息：昵称、邮箱、评论内容、时间、IP
- 显示在文章详情页

## 2. API 设计

| Method | Endpoint | 功能 |
|--------|----------|------|
| GET | /api/posts/{post_id}/comments | 获取文章评论 |
| POST | /api/posts/{post_id}/comments | 添加评论 |
| DELETE | /api/comments/{id} | 删除评论 |

## 3. 数据模型

### Comment
- id: int (PK)
- post_id: int (FK)
- nickname: str (昵称)
- email: str (邮箱)
- content: str (评论内容)
- ip_address: str (IP 地址)
- created_at: datetime (创建时间)

## 4. 前端

### 页面
- 文章详情页 `/posts/{slug}` 底部显示评论列表和评论表单

### 组件
- CommentList - 评论列表
- CommentForm - 评论表单

## 5. MVP 范围

- 仅基本评论功能
- 无回复功能
- 无评论审核