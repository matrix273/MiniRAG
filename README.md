# PageIndex

基于推理的文档索引和问答系统。

## 功能特性

- **文档索引**: 将 PDF/Markdown 文档转换为层级树结构索引
- **AI 问答**: 基于文档结构进行推理式检索和问答
- **Web 界面**: 完整的文档管理和聊天界面

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | FastAPI + SQLAlchemy (异步) + PostgreSQL |
| 前端 | React + TypeScript + Vite + Ant Design |
| AI | LiteLLM (多模型支持) |
| 文档处理 | PyMuPDF, PyPDF2 |

## 项目结构

```
kb/
├── backend/                     # 后端服务
│   ├── app/                     # Web 应用
│   │   ├── main.py              # FastAPI 应用入口
│   │   ├── core/config.py       # 配置管理
│   │   ├── models/              # SQLAlchemy 数据库模型
│   │   │   ├── database.py      # 数据库连接和表定义
│   │   │   ├── user.py          # 用户、角色、权限模型
│   │   │   └── base.py          # 模型基类
│   │   ├── schemas/             # Pydantic 数据模式
│   │   ├── services/            # 业务逻辑服务
│   │   │   ├── document_service.py  # 文档处理和聊天服务
│   │   │   ├── agent_service.py     # AI Agent 服务
│   │   │   ├── system_config_service.py  # 系统配置服务
│   │   │   └── prompt_service.py    # 提示词管理服务
│   │   └── api/                 # API 路由
│   │       ├── auth.py          # 认证相关 API
│   │       ├── admin.py         # 管理后台 API
│   │       └── documents.py     # 文档管理 API
│   ├── pageindex/               # 核心文档处理库
│   │   ├── page_index.py        # PDF 索引
│   │   ├── page_index_md.py     # Markdown 索引
│   │   ├── client.py            # PageIndex 客户端
│   │   └── retrieve.py          # 检索工具
│   ├── alembic/                 # 数据库迁移
│   ├── .env.example             # 环境变量示例
│   └── pyproject.toml           # Python 项目配置
├── frontend/                    # 前端应用
│   ├── src/
│   │   ├── pages/               # 页面组件
│   │   │   ├── Dashboard.tsx    # 仪表盘
│   │   │   ├── DocumentList.tsx # 文档列表
│   │   │   ├── Chat.tsx         # 聊天界面
│   │   │   └── PromptConfig.tsx # 配置管理
│   │   ├── services/            # API 客户端
│   │   └── types/               # TypeScript 类型定义
│   ├── package.json             # 前端依赖配置
│   └── vite.config.ts           # Vite 构建配置
├── docs/                        # 项目文档
├── DEPLOYMENT.md                # 部署指南
└── README.md                    # 项目说明
```

## 快速开始

### 前置条件

- Python 3.12+
- Node.js 18+
- PostgreSQL 12+
- uv (Python 包管理器)

### 1. 克隆项目

```bash
git clone <repository-url>
cd kb
```

### 2. 后端启动

```bash
cd backend

# 安装依赖
uv sync

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件，配置以下必填项：
#   DATABASE_URL=postgresql+asyncpg://用户名:密码@localhost:5432/pageindex
#   JWT_SECRET_KEY=你的JWT密钥

# 创建 PostgreSQL 数据库
psql -U postgres -c "CREATE DATABASE pageindex;"

# 启动后端服务（首次启动会自动创建表和初始化数据）
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**后端启动后**，访问 `http://localhost:8000` 可查看 API 文档。

### 3. 前端启动

打开新的终端窗口：

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

访问 `http://localhost:5173`，前端会自动代理 API 请求到后端。

### 4. 首次使用配置

1. 打开前端界面 `http://localhost:5173`
2. 进入「系统配置 → LLM 配置」页面
3. 配置以下项目：
   - **默认模型**：如 `dashscope/qwen-plus`
   - **API Key**：填入 DashScope 或 OpenAI 的 API Key
   - **视觉功能**：根据需要开启
4. 上传文档开始使用

## 开发说明

### 数据库初始化

应用启动时会自动：
- 创建所有数据库表
- 初始化默认系统配置
- 初始化默认提示词模板
- 创建角色和权限（admin/user/guest）

如需手动迁移数据库：

```bash
cd backend
uv run alembic upgrade head
```

### 环境变量说明

| 变量名 | 说明 | 必填 | 默认值 |
|--------|------|------|--------|
| `DATABASE_URL` | PostgreSQL 连接字符串 | 是 | `postgresql+asyncpg://postgres:postgres@localhost:5432/pageindex` |
| `JWT_SECRET_KEY` | JWT 认证密钥 | 是 | - |
| `DEBUG` | 调试模式 | 否 | `False` |
| `UPLOAD_DIR` | 文件上传目录 | 否 | `./uploads` |
| `MAX_UPLOAD_SIZE` | 最大上传文件大小（字节） | 否 | `52428800` (50MB) |
| `MILVUS_DB_PATH` | MilvusLite 数据库路径 | 否 | `./milvus_data.db` |

### LLM 配置

LLM 配置存储在数据库中，通过前端界面管理。首次使用需要在「系统配置 → LLM 配置」页面配置：
- `llm_default_model`：默认模型
- `llm_dashscope_key`：DashScope API Key
- `llm_openai_key`：OpenAI API Key（可选）
- `llm_vision_enabled`：视觉功能开关
- `llm_api_base_url`：API 基础 URL

### 前端开发

- 开发服务器运行在 `http://localhost:5173`
- API 请求自动代理到 `http://localhost:8000`
- 支持热重载，修改代码后自动更新

### 后端开发

- 开发服务器运行在 `http://localhost:8000`
- 使用 `--reload` 参数支持热重载
- API 文档访问：`http://localhost:8000/docs`（Swagger UI）

## API 端点

### 文档管理

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/documents/upload` | POST | 上传文档 |
| `/api/documents` | GET | 文档列表 |
| `/api/documents/{doc_id}` | GET | 文档详情 |
| `/api/documents/{doc_id}/structure` | GET | 树结构 |
| `/api/documents/{doc_id}` | DELETE | 删除文档 |
| `/api/documents/{doc_id}/reindex` | POST | 重新索引 |

### 聊天

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/documents/{doc_id}/chat` | POST | 创建会话 |
| `/api/documents/{doc_id}/chat` | GET | 会话列表 |
| `/api/chat/{session_id}/messages` | GET | 消息列表 |
| `/api/chat/{session_id}/message` | POST | 发送消息 |

## CLI 使用

```bash
cd backend

# PDF 索引
uv run python run_pageindex.py --pdf_path /path/to/document.pdf

# Markdown 索引
uv run python run_pageindex.py --md_path /path/to/document.md
```

## 生产环境部署

生产环境部署请参考 [DEPLOYMENT.md](DEPLOYMENT.md)，包含：
- Nginx 配置
- systemd 服务管理
- 域名和 HTTPS 配置
- 数据库备份策略

### 快速部署

```bash
# 1. 前端构建
cd frontend
npm run build

# 2. 后端部署
cd backend
uv sync --no-dev  # 只安装生产依赖

# 3. 启动服务
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## 贡献

欢迎贡献代码！请遵循以下步骤：

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 问题反馈

如有问题或建议，请创建 [Issue](https://github.com/your-username/kb/issues)。

## License

MIT License