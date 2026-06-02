# MiniRAG base on PageIndex

基于 AI 推理的文档索引和问答系统。支持多格式文档解析、层级树结构索引、智能问答和文档管理。

本项目基于 [PageIndex](https://github.com/VectifyAI/PageIndex) 进行了大幅重构，包括后端架构重写（FastAPI + SQLAlchemy 异步）、前端 React 界面、多格式文档解析（Office 系列）、向量检索（Milvus Lite）集成等功能重构。

## 部分截图
边栏支持查看原文,支持点击链接跳转到引用页
![pdf preview](docs/images/pdf.png)

Excel filtering support and message export to Markdown:
![pdf preview](docs/images/excel.png)

## 功能特性

- **多格式文档索引**：支持 PDF、Word、Excel、PowerPoint、Markdown 等多种文档格式
- **层级树结构索引**：自动将文档解析为层级树结构，保留文档逻辑层次
- **AI 推理式问答**：基于 OpenAI Agents SDK 的推理驱动检索，精准定位文档内容
- **自动文档匹配**：利用向量嵌入（Milvus + DashScope text-embedding-v3）自动匹配相关问题文档
- **流式回答**：支持 SSE 流式输出，实时展示 AI 回答过程
- **可视化阅读**：内置 PDF/Markdown/Office 文件预览器
- **智能引用**：AI 回答自动附带文档引用页码，支持一键跳转
- **多会话管理**：支持多会话、知识库筛选和自动匹配模式
- **Web 管理界面**：完整的文档管理、系统配置和聊天界面

## 支持的文档格式

| 格式 | 扩展名 | 解析引擎 | 说明 |
|------|--------|----------|------|
| PDF | `.pdf` | PyMuPDF / PyPDF2 | 文字提取、视觉 RAG、层级索引 |
| Word | `.docx` | python-docx | 提取标题、段落和格式信息 |
| Excel | `.xlsx` | openpyxl | 提取工作表为带标题的内容块 |
| PowerPoint | `.pptx` | python-pptx | 提取幻灯片内容 |
| Markdown | `.md`, `.markdown` | 内置 Markdown 解析器 | 基于标题构建层级树结构 |

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端框架 | FastAPI 0.136 (Python 3.12+) |
| ORM | SQLAlchemy 2.0 (异步, asyncpg) |
| 数据库 | PostgreSQL 12+ |
| AI / LLM | LiteLLM 1.83 (多模型支持), OpenAI Agents SDK |
| 向量数据库 | Milvus Lite (嵌入式) |
| 向量嵌入 | DashScope text-embedding-v3 |
| 文档解析 | PyMuPDF, PyPDF2, python-docx, python-pptx, openpyxl |
| 前端框架 | React 18 + TypeScript + Vite 6 |
| UI 组件库 | Ant Design 5.22 |
| PDF 预览 | pdfjs-dist |
| 认证 | JWT (PyJWT) + bcrypt |
| 部署 | Nginx, systemd, uvicorn |

## 项目结构

```
kb/
├── backend/                         # 后端服务 (FastAPI)
│   ├── app/
│   │   ├── main.py                  # FastAPI 应用入口
│   │   ├── core/
│   │   │   ├── config.py            # Pydantic 配置管理
│   │   │   ├── deps.py              # 依赖注入
│   │   │   └── security.py          # JWT 认证
│   │   ├── models/
│   │   │   ├── database.py          # SQLAlchemy 模型 (Document, ChatSession 等)
│   │   │   ├── base.py              # ORM 基类
│   │   │   └── user.py              # 用户 / 角色 / 权限模型
│   │   ├── schemas/                 # Pydantic 数据模式
│   │   ├── api/
│   │   │   ├── documents.py         # 文档 CRUD API
│   │   │   ├── auth.py              # 认证 API
│   │   │   └── admin.py             # 管理后台 API
│   │   ├── services/
│   │   │   ├── document_service.py  # 文档索引 / 聊天服务
│   │   │   ├── agent_service.py     # OpenAI Agents SDK 集成
│   │   │   ├── vector_service.py    # Milvus Lite 向量搜索
│   │   │   ├── system_config_service.py
│   │   │   ├── prompt_service.py    # 提示词模板管理
│   │   │   ├── auth_service.py
│   │   │   ├── role_service.py
│   │   │   └── indexing/            # 核心文档索引引擎
│   │   │       ├── client.py        # PageIndexClient (主入口)
│   │   │       ├── indexer.py       # 索引器工厂
│   │   │       ├── pdf_indexer.py   # PDF 树索引
│   │   │       ├── md_indexer.py    # Markdown 树索引
│   │   │       ├── retrieval.py     # 检索工具
│   │   │       ├── vision.py        # 视觉支持 (PDF 页面转图片)
│   │   │       ├── utils.py         # 配置加载器、格式化工具
│   │   │       └── parsers/         # 文档解析器
│   │   │           ├── pdf.py       # PDF 文本提取
│   │   │           ├── markdown.py  # Markdown 解析
│   │   │           ├── docx.py      # DOCX 解析
│   │   │           ├── xlsx.py      # XLSX 解析
│   │   │           ├── pptx.py      # PPTX 解析
│   │   │           ├── office_to_tree.py  # Office 统一入口
│   │   │           └── tree_builder.py    # 通用树构建器
│   │   └── utils/
│   │       └── llm.py               # LLM 工具 (摘要、描述生成)
│   ├── alembic/                     # 数据库迁移
│   ├── .env.example                 # 环境变量示例
│   └── pyproject.toml               # Python 项目配置
├── frontend/                        # 前端应用 (React + TypeScript)
│   ├── src/
│   │   ├── pages/
│   │   │   ├── ChatPage.tsx         # 聊天界面 (主要功能页面)
│   │   │   ├── Dashboard.tsx        # 仪表盘
│   │   │   ├── DocumentList.tsx     # 文档列表
│   │   │   ├── DocumentDetail.tsx   # 文档详情
│   │   │   ├── DocumentEdit.tsx     # 文档编辑
│   │   │   ├── AdminPage.tsx        # 管理面板
│   │   │   ├── PromptConfig.tsx     # 提示词配置
│   │   │   ├── LandingPage.tsx      # 登录页
│   │   │   ├── Login.tsx            # 登录表单
│   │   │   └── Register.tsx         # 注册表单
│   │   ├── components/
│   │   │   ├── PDFViewer.tsx        # PDF 预览
│   │   │   ├── MDViewer.tsx         # Markdown 渲染
│   │   │   ├── OfficeViewer.tsx     # Office 文档预览
│   │   │   ├── GenericFileViewer.tsx
│   │   │   ├── ReferencePanel.tsx   # 引用面板
│   │   │   ├── CreateMarkdownModal.tsx
│   │   │   └── ProtectedRoute.tsx
│   │   ├── services/
│   │   │   ├── api.ts              # API 客户端
│   │   │   └── authApi.ts          # 认证 API
│   │   ├── contexts/
│   │   │   └── AuthContext.tsx      # 认证上下文
│   │   ├── hooks/
│   │   │   └── useAuth.ts
│   │   ├── types/
│   │   │   └── index.ts            # TypeScript 类型定义
│   │   └── utils/
│   │       └── fileCache.ts        # 文件缓存工具
│   ├── package.json
│   ├── vite.config.ts              # Vite 构建配置
│   └── tsconfig.json
├── docs/                            # 项目文档
├── nginx.conf                       # Nginx 反向代理配置
├── DEPLOYMENT.md                    # 生产部署指南
├── pyproject.toml                   # 顶层 Python 配置
├── requirements.txt                 # pip 依赖
└── README.md                        # 项目说明
```

## 快速开始

### 前置条件

- Python 3.12+
- Node.js 18+
- PostgreSQL 12+
- uv (Python 包管理器)

### 1. 克隆项目

```bash
git clone https://github.com/matrix273/MiniRAG.git
cd MiniRAG
```

### 2. 后端启动

```bash
cd backend

# 安装依赖
uv sync

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件，配置以下必填项：
#   DATABASE_URL=postgresql+asyncpg://用户名:密码@localhost:5432/kb
#   JWT_SECRET_KEY=你的JWT密钥

# 创建 PostgreSQL 数据库
psql -U postgres -c "CREATE DATABASE kb;"

# 启动后端服务（首次启动会自动创建表和初始化数据）
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**后端启动后**，访问 `http://localhost:8000` 可查看 API 文档（Swagger UI）。

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
   - **API Key**：填入 DashScope 或 OpenAI 的 API Key（DashScope Key 从 [阿里云百炼](https://bailian.console.aliyun.com/cn-beijing?tab=model#/api-key) 申请）
   - **视觉功能**：根据需要开启
4. 上传文档开始使用

## 环境变量说明

| 变量名 | 说明 | 必填 | 默认值 |
|--------|------|------|--------|
| `DATABASE_URL` | PostgreSQL 连接字符串 | 是 | `postgresql+asyncpg://postgres:postgres@localhost:5432/kb` |
| `JWT_SECRET_KEY` | JWT 认证密钥 | 是 | - |
| `DEBUG` | 调试模式 | 否 | `False` |
| `UPLOAD_DIR` | 文件上传目录 | 否 | `./uploads` |
| `MAX_UPLOAD_SIZE` | 最大上传文件大小（字节） | 否 | `52428800` (50MB) |
| `MILVUS_DB_PATH` | MilvusLite 数据库路径 | 否 | `./milvus_data.db` |

## LLM 配置

LLM 配置存储在数据库中，通过前端界面管理。首次使用需要在「系统配置 → LLM 配置」页面配置：
- `llm_default_model`：默认模型
- `llm_dashscope_key`：DashScope API Key（[点击申请](https://bailian.console.aliyun.com/cn-beijing?tab=model#/api-key)）
- `llm_openai_key`：OpenAI API Key（可选）
- `llm_vision_enabled`：视觉功能开关
- `llm_api_base_url`：API 基础 URL

也可在 `.env` 中直接配置 `DASHSCOPE_API_KEY`，优先级低于数据库配置。

## 主要 API 端点

### 文档管理

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/documents/upload` | POST | 上传文档（支持多文件） |
| `/api/documents` | GET | 文档列表 |
| `/api/documents/{id}` | GET | 文档详情 |
| `/api/documents/{id}/structure` | GET | 树结构 |
| `/api/documents/{id}` | DELETE | 删除文档 |
| `/api/documents/{id}/reindex` | POST | 重新索引 |

### 聊天

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/chat/session` | POST | 创建会话 |
| `/api/chat/sessions` | GET | 会话列表 |
| `/api/chat/{session_id}/messages` | GET | 消息列表 |
| `/api/chat/message` | POST | 发送消息 |
| `/api/chat/stream` | POST | 流式发送消息 |

## 文档处理流程

1. **上传**：通过 `/api/documents/upload` 上传文件，支持 PDF、DOCX、XLSX、PPTX、Markdown 格式
2. **解析**：根据文档类型调用对应的解析器，提取文本和层级结构
3. **索引**：将文档构建为层级树结构，每个节点包含位置、层级、摘要等信息
4. **AI 摘要**：LLM 为树节点生成 AI 摘要，创建文档整体描述
5. **向量索引**：文档描述通过 `text-embedding-v3` 嵌入并存储在 Milvus Lite 中（用于自动文档匹配）
6. **检索 / 问答**：AI Agent 接收文档树结构，推理定位相关内容，通过工具获取具体内容后生成回答

## 生产环境部署

生产环境部署请参考 [DEPLOYMENT.md](DEPLOYMENT.md)，包含：
- Nginx 反向代理配置
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

如有问题或建议，请创建 [Issue](https://github.com/matrix273/MiniRAG/issues)。

## License

MIT License
