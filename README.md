# MiniRAG based on PageIndex

[中文版](README_CN.md) | English

An AI-powered document indexing and question-answering system. Supports multi-format document parsing, hierarchical tree structure indexing, intelligent Q&A, and document management.

This project is a major refactoring of [PageIndex](https://github.com/VectifyAI/PageIndex), including backend architecture rewrite (FastAPI + SQLAlchemy async), React frontend interface, multi-format document parsing (Office suite), and vector search (Milvus Lite) integration.

## Screenshots

Sidebar supports viewing original documents with clickable citation links:
![pdf preview](docs/images/pdf.png)

Excel filtering support and message export to Markdown:
![pdf preview](docs/images/excel.png)

## Features

- **Multi-format Document Indexing**: Supports PDF, Word, Excel, PowerPoint, Markdown and other document formats
- **Hierarchical Tree Structure Indexing**: Automatically parses documents into hierarchical tree structures, preserving document logical hierarchy
- **AI Reasoning-based Q&A**: Reasoning-driven retrieval based on OpenAI Agents SDK for precise document content localization
- **Automatic Document Matching**: Uses vector embeddings (Milvus + DashScope text-embedding-v3) to automatically match relevant question documents
- **Streaming Responses**: Supports SSE streaming output, displaying AI answer process in real-time
- **Visual Reading**: Built-in PDF/Markdown/Office file previewer
- **Smart Citations**: AI answers automatically include document citation page numbers with one-click jump support
- **Multi-session Management**: Supports multi-session, knowledge base filtering, and automatic matching mode
- **Web Management Interface**: Complete document management, system configuration, and chat interface

## Supported Document Formats

| Format | Extensions | Parser Engine | Description |
|--------|------------|---------------|-------------|
| PDF | `.pdf` | PyMuPDF / PyPDF2 | Text extraction, visual RAG, hierarchical indexing |
| Word | `.docx` | python-docx | Extract headings, paragraphs, and format information |
| Excel | `.xlsx` | openpyxl | Extract worksheets as titled content blocks |
| PowerPoint | `.pptx` | python-pptx | Extract slide content |
| Markdown | `.md`, `.markdown` | Built-in Markdown parser | Build hierarchical tree structure based on headings |

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend Framework | FastAPI 0.136 (Python 3.12+) |
| ORM | SQLAlchemy 2.0 (async, asyncpg) |
| Database | PostgreSQL 12+ |
| AI / LLM | LiteLLM 1.83 (multi-model support), OpenAI Agents SDK |
| Vector Database | Milvus Lite (embedded) |
| Vector Embedding | DashScope text-embedding-v3 |
| Document Parsing | PyMuPDF, PyPDF2, python-docx, python-pptx, openpyxl |
| Frontend Framework | React 18 + TypeScript + Vite 6 |
| UI Component Library | Ant Design 5.22 |
| PDF Preview | pdfjs-dist |
| Authentication | JWT (PyJWT) + bcrypt |
| Deployment | Nginx, systemd, uvicorn |

## Project Structure

```
kb/
├── backend/                         # Backend service (FastAPI)
│   ├── app/
│   │   ├── main.py                  # FastAPI application entry
│   │   ├── core/
│   │   │   ├── config.py            # Pydantic configuration management
│   │   │   ├── deps.py              # Dependency injection
│   │   │   └── security.py          # JWT authentication
│   │   ├── models/
│   │   │   ├── database.py          # SQLAlchemy models (Document, ChatSession, etc.)
│   │   │   ├── base.py              # ORM base class
│   │   │   └── user.py              # User / Role / Permission models
│   │   ├── schemas/                 # Pydantic data schemas
│   │   ├── api/
│   │   │   ├── documents.py         # Document CRUD API
│   │   │   ├── auth.py              # Authentication API
│   │   │   └── admin.py             # Admin backend API
│   │   ├── services/
│   │   │   ├── document_service.py  # Document indexing / chat service
│   │   │   ├── agent_service.py     # OpenAI Agents SDK integration
│   │   │   ├── vector_service.py    # Milvus Lite vector search
│   │   │   ├── system_config_service.py
│   │   │   ├── prompt_service.py    # Prompt template management
│   │   │   ├── auth_service.py
│   │   │   ├── role_service.py
│   │   │   └── indexing/            # Core document indexing engine
│   │   │       ├── client.py        # PageIndexClient (main entry)
│   │   │       ├── indexer.py       # Indexer factory
│   │   │       ├── pdf_indexer.py   # PDF tree indexing
│   │   │       ├── md_indexer.py    # Markdown tree indexing
│   │   │       ├── retrieval.py     # Retrieval tools
│   │   │       ├── vision.py        # Vision support (PDF page to image)
│   │   │       ├── utils.py         # Configuration loader, formatting tools
│   │   │       └── parsers/         # Document parsers
│   │   │           ├── pdf.py       # PDF text extraction
│   │   │           ├── markdown.py  # Markdown parsing
│   │   │           ├── docx.py      # DOCX parsing
│   │   │           ├── xlsx.py      # XLSX parsing
│   │   │           ├── pptx.py      # PPTX parsing
│   │   │           ├── office_to_tree.py  # Office unified entry
│   │   │           └── tree_builder.py    # Universal tree builder
│   │   └── utils/
│   │       └── llm.py               # LLM tools (summary, description generation)
│   ├── alembic/                     # Database migrations
│   ├── .env.example                 # Environment variables example
│   └── pyproject.toml               # Python project configuration
├── frontend/                        # Frontend application (React + TypeScript)
│   ├── src/
│   │   ├── pages/
│   │   │   ├── ChatPage.tsx         # Chat interface (main functional page)
│   │   │   ├── Dashboard.tsx        # Dashboard
│   │   │   ├── DocumentList.tsx     # Document list
│   │   │   ├── DocumentDetail.tsx   # Document details
│   │   │   ├── DocumentEdit.tsx     # Document editing
│   │   │   ├── AdminPage.tsx        # Admin panel
│   │   │   ├── PromptConfig.tsx     # Prompt configuration
│   │   │   ├── LandingPage.tsx      # Login page
│   │   │   ├── Login.tsx            # Login form
│   │   │   └── Register.tsx         # Registration form
│   │   ├── components/
│   │   │   ├── PDFViewer.tsx        # PDF preview
│   │   │   ├── MDViewer.tsx         # Markdown rendering
│   │   │   ├── OfficeViewer.tsx     # Office document preview
│   │   │   ├── GenericFileViewer.tsx
│   │   │   ├── ReferencePanel.tsx   # Reference panel
│   │   │   ├── CreateMarkdownModal.tsx
│   │   │   └── ProtectedRoute.tsx
│   │   ├── services/
│   │   │   ├── api.ts              # API client
│   │   │   └── authApi.ts          # Authentication API
│   │   ├── contexts/
│   │   │   └── AuthContext.tsx      # Authentication context
│   │   ├── hooks/
│   │   │   └── useAuth.ts
│   │   ├── types/
│   │   │   └── index.ts            # TypeScript type definitions
│   │   └── utils/
│   │       └── fileCache.ts        # File cache utilities
│   ├── package.json
│   ├── vite.config.ts              # Vite build configuration
│   └── tsconfig.json
├── docs/                            # Project documentation
├── nginx.conf                       # Nginx reverse proxy configuration
├── DEPLOYMENT.md                    # Production deployment guide
├── pyproject.toml                   # Top-level Python configuration
├── requirements.txt                 # pip dependencies
└── README.md                        # Project description
```

## Quick Start

### Prerequisites

- Python 3.12+
- Node.js 18+
- PostgreSQL 12+
- uv (Python package manager)

### 1. Clone the Project

```bash
git clone https://github.com/matrix273/MiniRAG.git
cd MiniRAG
```

### 2. Backend Startup

```bash
cd backend

# Install dependencies
uv sync

# Configure environment variables
cp .env.example .env
# Edit .env file and configure the following required items:
#   DATABASE_URL=postgresql+asyncpg://username:password@localhost:5432/kb
#   JWT_SECRET_KEY=your-jwt-secret-key

# Create PostgreSQL database
psql -U postgres -c "CREATE DATABASE kb;"

# Start backend service (first startup will automatically create tables and initialize data)
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**After backend startup**, visit `http://localhost:8000` to view API documentation (Swagger UI).

### 3. Frontend Startup

Open a new terminal window:

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

Visit `http://localhost:5173`, the frontend will automatically proxy API requests to the backend.

### 4. First Use Configuration

1. Open the frontend interface `http://localhost:5173`
2. Go to "System Configuration → LLM Configuration" page
3. Configure the following items:
   - **Default Model**: e.g., `dashscope/qwen-plus`
   - **API Key**: Enter DashScope or OpenAI API key (DashScope key can be applied from [Alibaba Cloud Bailian](https://bailian.console.aliyun.com/cn-beijing?tab=model#/api-key))
   - **Vision Functionality**: Enable as needed
4. Upload documents to start using

## Environment Variables

| Variable | Description | Required | Default Value |
|----------|-------------|----------|---------------|
| `DATABASE_URL` | PostgreSQL connection string | Yes | `postgresql+asyncpg://postgres:postgres@localhost:5432/kb` |
| `JWT_SECRET_KEY` | JWT authentication secret | Yes | - |
| `DEBUG` | Debug mode | No | `False` |
| `UPLOAD_DIR` | File upload directory | No | `./uploads` |
| `MAX_UPLOAD_SIZE` | Maximum upload file size (bytes) | No | `52428800` (50MB) |
| `MILVUS_DB_PATH` | MilvusLite database path | No | `./milvus_data.db` |

## LLM Configuration

LLM configuration is stored in the database and managed through the frontend interface. First-time use requires configuration on "System Configuration → LLM Configuration" page:
- `llm_default_model`: Default model
- `llm_dashscope_key`: DashScope API Key ([Apply here](https://bailian.console.aliyun.com/cn-beijing?tab=model#/api-key))
- `llm_openai_key`: OpenAI API Key (optional)
- `llm_vision_enabled`: Vision functionality switch
- `llm_api_base_url`: API base URL

You can also configure `DASHSCOPE_API_KEY` directly in `.env`, with lower priority than database configuration.

## API Endpoints

### Document Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/documents/upload` | POST | Upload documents (supports multiple files) |
| `/api/documents` | GET | Document list |
| `/api/documents/{id}` | GET | Document details |
| `/api/documents/{id}/structure` | GET | Tree structure |
| `/api/documents/{id}` | DELETE | Delete document |
| `/api/documents/{id}/reindex` | POST | Re-index document |

### Chat

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chat/session` | POST | Create session |
| `/api/chat/sessions` | GET | Session list |
| `/api/chat/{session_id}/messages` | GET | Message list |
| `/api/chat/message` | POST | Send message |
| `/api/chat/stream` | POST | Streaming message |

## Document Processing Flow

1. **Upload**: Upload files via `/api/documents/upload`, supports PDF, DOCX, XLSX, PPTX, Markdown formats
2. **Parsing**: Call corresponding parser based on document type to extract text and hierarchical structure
3. **Indexing**: Build documents into hierarchical tree structures, each node contains position, level, summary and other information
4. **AI Summarization**: LLM generates AI summaries for tree nodes, creating overall document descriptions
5. **Vector Indexing**: Document descriptions are embedded via `text-embedding-v3` and stored in Milvus Lite (for automatic document matching)
6. **Retrieval / Q&A**: AI Agent receives document tree structure, reasons to locate relevant content, obtains specific content through tools to generate answers

## Production Deployment

For production environment deployment, please refer to [DEPLOYMENT.md](DEPLOYMENT.md), which includes:
- Nginx reverse proxy configuration
- systemd service management
- Domain and HTTPS configuration
- Database backup strategy

### Quick Deployment

```bash
# 1. Frontend build
cd frontend
npm run build

# 2. Backend deployment
cd backend
uv sync --no-dev  # Only install production dependencies

# 3. Start service
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the project
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Create a Pull Request

## Feedback

If you have questions or suggestions, please create an [Issue](https://github.com/your-username/kb/issues).

## License

MIT License
