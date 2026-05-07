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
PageIndex/
├── backend/               # 后端服务
│   ├── app/               # Web 应用
│   │   ├── main.py        # API 端点
│   │   ├── core/config.py # 配置
│   │   ├── models/        # 数据库模型
│   │   ├── schemas/       # 数据模式
│   │   └── services/      # 业务服务
│   ├── pageindex/        # 核心库
│   │   ├── page_index.py # PDF 索引
│   │   ├── page_index_md.py # Markdown 索引
│   │   ├── client.py     # 客户端
│   │   └── retrieve.py   # 检索工具
│   └── run_pageindex.py  # CLI 工具
├── frontend/             # 前端应用
│   └── src/
│       ├── pages/         # 页面组件
│       ├── services/     # API 客户端
│       └── types/        # 类型定义
```

## 快速开始

### 后端

```bash
cd backend

# 安装依赖
uv sync

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入 DATABASE_URL 和 API Key

# 初始化数据库
uv run alembic upgrade head

# 启动服务
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 前端

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

访问 `http://localhost:5173`

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
# PDF 索引
python run_pageindex.py --pdf_path /path/to/document.pdf

# Markdown 索引
python run_pageindex.py --md_path /path/to/document.md
```

## License

MIT License