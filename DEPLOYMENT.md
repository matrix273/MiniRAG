# 多前端项目部署指南

本文档说明如何将 PageIndex 和 HR 两个前端项目独立打包并部署到 Nginx。

## 项目结构

```
/opt/deploy/
├── pageindex/          # PageIndex 项目
│   ├── frontend/dist/  # 前端构建产物
│   └── backend/        # 后端服务 (端口 8000)
├── hr/                 # HR 项目
│   ├── frontend/dist/  # 前端构建产物
│   └── backend/        # 后端服务 (端口 8001)
└── nginx/
    └── nginx.conf      # Nginx 配置文件
```

## 1. 前端打包

### PageIndex 项目

```bash
cd /Users/neo/PycharmProjects/PageIndex/frontend
uv run npm run build
# 或
uv run vite build
```

构建产物位于 `frontend/dist/`，已配置 `base: '/app1/'`。

### HR 项目

```bash
cd /Users/neo/PycharmProjects/hr/frontend
npm run build
# 或
vite build
```

构建产物位于 `frontend/dist/`，已配置 `base: '/app2/'`。

## 2. 部署到服务器

### 2.1 上传构建产物

```bash
# PageIndex 前端
scp -r /Users/neo/PycharmProjects/PageIndex/frontend/dist/* user@server:/opt/deploy/pageindex/frontend/dist/

# HR 前端
scp -r /Users/neo/PycharmProjects/hr/frontend/dist/* user@server:/opt/deploy/hr/frontend/dist/
```

### 2.2 上传 Nginx 配置

```bash
scp /Users/neo/PycharmProjects/PageIndex/nginx.conf user@server:/opt/deploy/nginx/
```

## 3. 服务器端配置

### 3.1 安装 Nginx

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install nginx

# CentOS/RHEL
sudo yum install nginx
```

### 3.2 配置 Nginx

```bash
# 复制配置文件
sudo cp /opt/deploy/nginx/nginx.conf /etc/nginx/conf.d/multi-app.conf

# 修改路径（根据实际部署位置）
sudo nano /etc/nginx/conf.d/multi-app.conf
```

更新以下路径：
- `/path/to/PageIndex/frontend/dist/` → `/opt/deploy/pageindex/frontend/dist/`
- `/path/to/hr/frontend/dist/` → `/opt/deploy/hr/frontend/dist/`

### 3.3 启动服务

```bash
# 测试配置
sudo nginx -t

# 重启 Nginx
sudo systemctl restart nginx
sudo systemctl enable nginx
```

## 4. 后端服务部署

### 4.1 PageIndex 后端

```bash
cd /opt/deploy/pageindex/backend
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 4.2 HR 后端

```bash
cd /opt/deploy/hr/backend
uv run uvicorn app.main:app --host 0.0.0.0 --port 8001
```

## 5. 使用 systemd 管理后端服务

### PageIndex 后端服务

```bash
sudo tee /etc/systemd/system/pageindex.service << 'EOF'
[Unit]
Description=PageIndex Backend
After=network.target

[Service]
User=www-data
WorkingDirectory=/opt/deploy/pageindex/backend
ExecStart=/usr/bin/uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl start pageindex
sudo systemctl enable pageindex
```

### HR 后端服务

```bash
sudo tee /etc/systemd/system/hr.service << 'EOF'
[Unit]
Description=HR Backend
After=network.target

[Service]
User=www-data
WorkingDirectory=/opt/deploy/hr/backend
ExecStart=/usr/bin/uv run uvicorn app.main:app --host 0.0.0.0 --port 8001
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl start hr
sudo systemctl enable hr
```

## 6. 访问地址

- **PageIndex**: http://your-domain.com/app1/
- **HR**: http://your-domain.com/app2/
- **根路径**: 自动重定向到 PageIndex

## 7. 开发环境

### 启动开发服务器

```bash
# PageIndex
cd /Users/neo/PycharmProjects/PageIndex/frontend
uv run vite --port 5173

# HR
cd /Users/neo/PycharmProjects/hr/frontend
npm run dev -- --port 5174
```

开发环境会自动代理 API 请求到本地后端。

## 8. 故障排查

### 检查 Nginx 状态

```bash
sudo systemctl status nginx
sudo tail -f /var/log/nginx/error.log
```

### 检查后端服务

```bash
sudo systemctl status pageindex
sudo systemctl status hr
sudo journalctl -u pageindex -f
sudo journalctl -u hr -f
```

### 测试 API 连通性

```bash
# PageIndex API
curl http://localhost:8000/api/health

# HR API
curl http://localhost:8001/api/health
```

## 9. 注意事项

1. **CORS 配置**: 确保后端的 CORS 配置允许前端域名访问
2. **文件上传**: Nginx 已配置 `client_max_body_size 50M`，可根据需要调整
3. **HTTPS**: 生产环境建议配置 SSL 证书
4. **备份**: 定期备份数据库和上传的文件
