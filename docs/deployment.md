# X-Blog 部署指南

## 环境要求

| 软件 | 版本 |
|------|------|
| Ubuntu | 22.04+ |
| Docker | 24+ |
| Docker Compose | 2.20+ |

## 快速开始

### 1. 克隆代码
```bash
git clone https://github.com/your-username/x-blog.git
cd x-blog
```

### 2. 配置环境变量
```bash
cp backend/.env.example backend/.env
# 编辑 backend/.env 设置 JWT_SECRET_KEY
```

### 3. 启动服务
```bash
docker-compose up -d
```

### 4. 验证服务
```bash
curl http://localhost          # 前端
curl http://localhost/api/posts  # 后端 API
```

## 更新部署

```bash
git pull origin main
docker-compose build
docker-compose up -d
```

## 常用命令

| 命令 | 说明 |
|------|------|
| docker-compose up -d | 后台启动 |
| docker-compose logs -f | 查看日志 |
| docker-compose restart | 重启服务 |
| docker-compose down | 停止服务 |

## SSL 配置 (可选)

使用 Let's Encrypt:
```bash
sudo apt install certbot
sudo certbot --nginx -d yourdomain.com
```

## 故障排除

### 查看日志
```bash
docker-compose logs -f backend
docker-compose logs -f frontend
```

### 重置数据库
```bash
docker-compose down -v
rm -rf data/
docker-compose up -d
```