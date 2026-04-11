# 测试覆盖增强设计

**日期**: 2026-04-11  
**状态**: 待批准

## 1. 目标

将测试总数从 42 提升到 72+ (后端 36 + 前端 36)

## 2. 后端测试

### 2.1 修复 admin 测试隔离 (目标: 15 tests)

**问题**: test_admin.py 与其他测试共享数据库，导致冲突

**方案**: 使用独立数据库文件 `test_admin_isolated.db`

```python
SQLALCHEMY_DATABASE_URL = "sqlite:///./test_admin_isolated.db"
```

包含现有 15 个测试的修复运行

### 2.2 新增 auth 单元测试 (6 tests)

| 测试名 | 描述 |
|--------|------|
| test_login_success | 成功登录 |
| test_login_wrong_password | 错误密码 |
| test_login_nonexistent_user | 用户不存在 |
| test_create_access_token | 创建 token |
| test_verify_password | 验证密码 |
| test_get_current_user_unauthorized | 未授权访问 |

### 2.3 新增 search 边界测试 (3 tests)

| 测试名 | 描述 |
|--------|------|
| test_search_empty_query | 空查询 |
| test_search_special_characters | 特殊字符 |
| test_search_case_insensitive | 大小写不敏感 |

**后端小计**: 修复 15 + 新增 9 = 24 tests (原 21 + 24 = 45)

## 3. 前端测试

### 3.1 Hooks 单元测试 (10 tests)

| Hook | 测试内容 |
|------|----------|
| usePosts | 分页、筛选、加载状态 |
| usePost | 详情获取、404 |
| useCategories | 列表、加载 |
| useTags | 列表、加载 |
| useComments | 评论列表 |

### 3.2 API 单元测试 (7 tests)

- fetchPosts 错误处理
- fetchPost 404 处理
- createPost 成功/失败
- updatePost 成功/失败
- deletePost

### 3.3 组件集成测试 (4 tests)

- Header 导航
- Footer 链接
- Pagination 交互
- SearchBox 提交

**前端小计**: 10 + 7 + 4 = 21 tests (原 21 + 21 = 42)

## 4. 测试配置

### 4.1 后端 conftest.py

```python
@pytest.fixture
def client():
    return TestClient(app)
```

### 4.2 前端 MSW

使用 Mock Service Worker 拦截 API 请求

## 5. 验收标准

- [ ] 后端测试: 21 → 45 (+24)
- [ ] 前端测试: 21 → 42 (+21)
- [ ] 所有测试通过
- [ ] lint 通过