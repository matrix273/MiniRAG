# Agentic Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 ChatService 的关键词匹配 + litellm 直接调用重构为 OpenAI Agents SDK Agent 自主推理模式，并新增提示词版本管理和 Agent 参数配置系统。

**Architecture:** ChatService 用 Agent SDK 的 `Runner.run()` 替代 `litellm.completion()`，Agent 通过 `@function_tool` 调用 PageIndexClient 的三个方法自主检索。提示词和 Agent 参数存入 PostgreSQL，通过 API 管理，前端可配置。

**Tech Stack:** Python 3.12+, FastAPI, SQLAlchemy async, OpenAI Agents SDK (`openai-agents`), `openai` (AsyncOpenAI for DashScope), PostgreSQL, React + TypeScript + Ant Design, Alembic

**Design spec:** `docs/superpowers/specs/2026-05-13-agentic-refactor-design.md`

---

## File Structure

```
backend/app/models/database.py          — 新增 PromptConfig, SystemConfig 模型
backend/app/schemas/schemas.py          — 新增 Prompt/SystemConfig Pydantic schema
backend/app/services/prompt_service.py  — 新增：提示词 CRUD + 内存缓存
backend/app/services/agent_service.py   — 新增：Agent 创建、工具函数、兜底逻辑
backend/app/services/document_service.py — 重写 ChatService，调用 agent_service
backend/app/main.py                     — 新增 /api/prompts 和 /api/system-configs 路由
backend/alembic/versions/xxx_add_prompt_config_and_system_config.py — 新增迁移
backend/tests/test_prompt_service.py    — 新增
backend/tests/test_agent_service.py     — 新增
frontend/src/types/index.ts             — 新增 PromptConfig, SystemConfig 类型
frontend/src/services/api.ts            — 新增 promptApi, systemConfigApi
frontend/src/pages/PromptConfig.tsx      — 新增：提示词管理 + Agent 参数页面
frontend/src/App.tsx                    — 修改：新增路由和菜单项
```

---

## Task 1: 数据库模型 — PromptConfig + SystemConfig

**Files:**
- Modify: `backend/app/models/database.py:1-119`
- Modify: `backend/app/schemas/schemas.py:1-118`
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/test_prompt_service.py`

- [ ] **Step 1: 创建 tests 目录和 __init__**

```bash
mkdir -p backend/tests
touch backend/tests/__init__.py
```

- [ ] **Step 2: 在 database.py 末尾（`init_db` 函数之前）新增 PromptConfig 模型**

在 `database.py` 的 `async def init_db():` 之前插入：

```python
class PromptConfig(Base):
    """Prompt configuration with version management."""
    __tablename__ = "prompt_configs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    category: Mapped[str] = mapped_column(String(50), nullable=False)  # agent_system, rag_template, indexing, post_processing
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(default=False)
    description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SystemConfig(Base):
    """System configuration key-value store."""
    __tablename__ = "system_configs"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=func.now(), onupdate=func.now(), server_default=func.now())
```

- [ ] **Step 3: 在 schemas.py 末尾新增 Pydantic schema**

```python
# Prompt Schemas
class PromptConfigCreate(BaseModel):
    name: str
    content: str
    description: Optional[str] = None


class PromptConfigResponse(BaseModel):
    id: str
    category: str
    name: str
    content: str
    version: int
    is_active: bool
    description: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


# SystemConfig Schemas
class SystemConfigResponse(BaseModel):
    key: str
    value: str
    description: Optional[str] = None
    updated_at: datetime

    class Config:
        from_attributes = True


class SystemConfigUpdate(BaseModel):
    value: str
```

- [ ] **Step 4: 运行 alembic 迁移生成表**

```bash
cd backend && uv run alembic revision --autogenerate -m "add prompt_config and system_config tables" && uv run alembic upgrade head
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/database.py backend/app/schemas/schemas.py backend/tests/ backend/alembic/versions/
git commit -m "feat: add PromptConfig and SystemConfig database models"
```

---

## Task 2: 提示词 CRUD 服务

**Files:**
- Create: `backend/app/services/prompt_service.py`

- [ ] **Step 1: 创建 prompt_service.py 完整内容**

```python
"""Prompt configuration CRUD service with in-memory cache."""

from typing import Optional
from sqlalchemy import select, func as sql_func
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.database import PromptConfig, engine
from sqlalchemy.orm import sessionmaker

_cache: dict[str, str] = {}

DEFAULT_PROMPTS = {
    "agent_system": {
        "name": "Agent System Prompt",
        "content": """You are PageIndex, a document QA assistant.
TOOL USE:
- Call get_document() first to confirm status and page/line count.
- Call get_document_structure() to identify relevant page ranges.
- Call get_page_content(pages="5-7") with tight ranges; never fetch the whole document.
- Before each tool call, output one short sentence explaining the reason.
Answer based only on tool output. Be concise.""",
        "description": "Agent 行为和工具使用策略",
    },
    "rag_template": {
        "name": "RAG Answer Template",
        "content": """ANSWER FORMAT:
- Use $ ... $ for inline formulas, $$ ... $$ for display formulas.
  Do NOT use [ ... ] or \\( ... \\) for LaTeX.
- Cite sources with [1], [2] at the end of each sentence using document content.
- Only cite pages you actually used.
- Be clear and concise.""",
        "description": "RAG 问答答案格式要求",
    },
    "indexing": {
        "name": "Indexing Prompt",
        "content": "Indexing prompts are configured in the pageindex module. This entry serves as a placeholder for future DB-driven indexing configuration.",
        "description": "索引构建提示词（暂存）",
    },
    "post_processing": {
        "name": "Post-Processing Rules",
        "content": """Post-processing rules:
1. Convert \\[ ... \\] to $$ ... $$ for KaTeX rendering.
2. Add citation markers [1], [2] if not present.
3. Skip conversion for citation numbers like [1] and page refs like 第3页.""",
        "description": "后处理规则（LaTeX 转换、引用标记）",
    },
}


async def _get_session() -> AsyncSession:
    AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    return AsyncSessionLocal()


def invalidate_cache(category: Optional[str] = None):
    if category:
        _cache.pop(category, None)
    else:
        _cache.clear()


async def get_active_prompt(category: str) -> str:
    if category in _cache:
        return _cache[category]

    async with await _get_session() as db:
        result = await db.execute(
            select(PromptConfig)
            .where(PromptConfig.category == category, PromptConfig.is_active == True)
        )
        row = result.scalar_one_or_none()
        if row:
            _cache[category] = row.content
            return row.content
    return ""


async def get_all_active_prompts() -> dict[str, str]:
    categories = ["agent_system", "rag_template", "indexing", "post_processing"]
    result = {}
    for cat in categories:
        result[cat] = await get_active_prompt(cat)
    return result


async def list_versions(category: str):
    async with await _get_session() as db:
        result = await db.execute(
            select(PromptConfig)
            .where(PromptConfig.category == category)
            .order_by(PromptConfig.version.desc())
        )
        return result.scalars().all()


async def create_prompt(category: str, name: str, content: str, description: str = None):
    async with await _get_session() as db:
        # Get next version number
        result = await db.execute(
            select(sql_func.coalesce(sql_func.max(PromptConfig.version), 0))
            .where(PromptConfig.category == category)
        )
        max_version = result.scalar() or 0

        # Deactivate current active
        current = await db.execute(
            select(PromptConfig)
            .where(PromptConfig.category == category, PromptConfig.is_active == True)
        )
        for row in current.scalars().all():
            row.is_active = False

        # Create new version
        prompt = PromptConfig(
            category=category,
            name=name,
            content=content,
            version=max_version + 1,
            is_active=True,
            description=description,
        )
        db.add(prompt)
        await db.commit()
        invalidate_cache(category)
        return prompt


async def activate_prompt(category: str, prompt_id: str):
    async with await _get_session() as db:
        # Deactivate all in category
        result = await db.execute(
            select(PromptConfig)
            .where(PromptConfig.category == category, PromptConfig.is_active == True)
        )
        for row in result.scalars().all():
            row.is_active = False

        # Activate target
        target = await db.execute(
            select(PromptConfig).where(PromptConfig.id == prompt_id)
        )
        prompt = target.scalar_one_or_none()
        if prompt:
            prompt.is_active = True
            await db.commit()
            invalidate_cache(category)
        return prompt


async def delete_prompt(prompt_id: str):
    async with await _get_session() as db:
        result = await db.execute(
            select(PromptConfig).where(PromptConfig.id == prompt_id)
        )
        prompt = result.scalar_one_or_none()
        if prompt and not prompt.is_active:
            category = prompt.category
            await db.delete(prompt)
            await db.commit()
            invalidate_cache(category)
            return True
        return False


async def init_default_prompts():
    """Insert default prompts if table is empty."""
    async with await _get_session() as db:
        result = await db.execute(select(sql_func.count(PromptConfig.id)))
        count = result.scalar()
        if count == 0:
            for cat, info in DEFAULT_PROMPTS.items():
                prompt = PromptConfig(
                    category=cat,
                    name=info["name"],
                    content=info["content"],
                    version=1,
                    is_active=True,
                    description=info["description"],
                )
                db.add(prompt)
            await db.commit()
```

- [ ] **Step 2: 在 main.py 的 startup 事件中调用 init_default_prompts**

在 `backend/app/main.py` 的 `startup()` 函数中，在 `await init_db()` 之后添加：

```python
from app.services.prompt_service import init_default_prompts
await init_default_prompts()
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/prompt_service.py backend/app/main.py
git commit -m "feat: add prompt CRUD service with cache and default prompts"
```

---

## Task 3: SystemConfig 服务 + Prompt/SystemConfig API 路由

**Files:**
- Create: `backend/app/services/system_config_service.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: 创建 system_config_service.py**

```python
"""System configuration key-value store service."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import sessionmaker
from app.models.database import SystemConfig, engine

_cache: dict[str, str] = {}

DEFAULT_CONFIGS = {
    "agent_max_turns": {"value": "5", "description": "Agent 最大 tool call 轮数"},
    "agent_max_tokens": {"value": "2048", "description": "单次 LLM 回答最大 token 数"},
    "agent_timeout_seconds": {"value": "60", "description": "Agent 整体超时秒数"},
}


async def _get_session() -> AsyncSession:
    AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    return AsyncSessionLocal()


def invalidate_cache(key: str = None):
    if key:
        _cache.pop(key, None)
    else:
        _cache.clear()


async def get_config(key: str) -> str:
    if key in _cache:
        return _cache[key]
    async with await _get_session() as db:
        result = await db.execute(select(SystemConfig).where(SystemConfig.key == key))
        row = result.scalar_one_or_none()
        if row:
            _cache[key] = row.value
            return row.value
    return ""


async def get_config_int(key: str, default: int = 0) -> int:
    val = await get_config(key)
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


async def list_configs():
    async with await _get_session() as db:
        result = await db.execute(select(SystemConfig).order_by(SystemConfig.key))
        return result.scalars().all()


async def update_config(key: str, value: str):
    async with await _get_session() as db:
        result = await db.execute(select(SystemConfig).where(SystemConfig.key == key))
        row = result.scalar_one_or_none()
        if row:
            row.value = value
        else:
            row = SystemConfig(key=key, value=value)
            db.add(row)
        await db.commit()
        invalidate_cache(key)
        return row


async def init_default_configs():
    async with await _get_session() as db:
        result = await db.execute(select(SystemConfig))
        existing = {row.key for row in result.scalars().all()}
        for key, info in DEFAULT_CONFIGS.items():
            if key not in existing:
                db.add(SystemConfig(key=key, value=info["value"], description=info["description"]))
        await db.commit()
```

- [ ] **Step 2: 在 main.py startup 中调用 init_default_configs**

在 `init_default_prompts()` 之后添加：

```python
from app.services.system_config_service import init_default_configs
await init_default_configs()
```

- [ ] **Step 3: 在 main.py 中添加 Prompt 和 SystemConfig API 路由**

在文件末尾 `health_check` 之前插入：

```python
# ========== Prompt Endpoints ==========

@app.get("/api/prompts")
async def list_all_prompts():
    from app.services.prompt_service import get_all_active_prompts
    prompts = await get_all_active_prompts()
    return prompts


@app.get("/api/prompts/{category}")
async def get_prompt(category: str):
    from app.services.prompt_service import get_active_prompt
    content = await get_active_prompt(category)
    if not content:
        raise HTTPException(status_code=404, detail=f"No active prompt for category: {category}")
    return {"category": category, "content": content}


@app.get("/api/prompts/{category}/versions")
async def list_prompt_versions(category: str):
    from app.services.prompt_service import list_versions
    versions = await list_versions(category)
    return [
        {
            "id": v.id,
            "category": v.category,
            "name": v.name,
            "content": v.content,
            "version": v.version,
            "is_active": v.is_active,
            "description": v.description,
            "created_at": v.created_at,
        }
        for v in versions
    ]


@app.post("/api/prompts/{category}")
async def create_prompt_version(category: str, data: PromptConfigCreate):
    from app.services.prompt_service import create_prompt
    prompt = await create_prompt(category, data.name, data.content, data.description)
    return {
        "id": prompt.id,
        "category": prompt.category,
        "name": prompt.name,
        "content": prompt.content,
        "version": prompt.version,
        "is_active": prompt.is_active,
        "description": prompt.description,
        "created_at": prompt.created_at,
    }


@app.put("/api/prompts/{category}/active/{prompt_id}")
async def activate_prompt_version(category: str, prompt_id: str):
    from app.services.prompt_service import activate_prompt
    prompt = await activate_prompt(category, prompt_id)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return {"message": f"Activated version {prompt.version} for {category}"}


@app.delete("/api/prompts/{category}/versions/{prompt_id}")
async def delete_prompt_version(category: str, prompt_id: str):
    from app.services.prompt_service import delete_prompt
    success = await delete_prompt(prompt_id)
    if not success:
        raise HTTPException(status_code=400, detail="Cannot delete active prompt or prompt not found")
    return {"message": "Prompt version deleted"}


# ========== SystemConfig Endpoints ==========

@app.get("/api/system-configs")
async def list_system_configs():
    from app.services.system_config_service import list_configs
    configs = await list_configs()
    return [
        {
            "key": c.key,
            "value": c.value,
            "description": c.description,
            "updated_at": c.updated_at,
        }
        for c in configs
    ]


@app.put("/api/system-configs/{key}")
async def update_system_config(key: str, data: SystemConfigUpdate):
    from app.services.system_config_service import update_config
    config = await update_config(key, data.value)
    return {
        "key": config.key,
        "value": config.value,
        "description": config.description,
        "updated_at": config.updated_at,
    }
```

- [ ] **Step 4: 在 main.py 顶部 import 中添加新 schema**

```python
from app.schemas.schemas import (
    ...existing imports...,
    PromptConfigCreate,
    SystemConfigUpdate,
)
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/system_config_service.py backend/app/main.py
git commit -m "feat: add system config service and prompt/config API routes"
```

---

## Task 4: Agent 服务 — 工具函数 + 兜底

**Files:**
- Create: `backend/app/services/agent_service.py`

- [ ] **Step 1: 创建 agent_service.py 完整内容**

```python
"""Agent service: creates Agent with tools, runs with guardrails and fallback."""

import os
import asyncio
from typing import Optional
from openai import AsyncOpenAI
from agents import Agent, Runner, function_tool, OpenAIChatCompletionsModel

from app.core.config import get_settings

settings = get_settings()


def create_model() -> OpenAIChatCompletionsModel:
    """Create OpenAIChatCompletionsModel pointed at DashScope."""
    api_key = settings.DASHSCOPE_API_KEY or settings.OPENAI_API_KEY
    # Agent SDK uses OPENAI_API_KEY internally
    os.environ["OPENAI_API_KEY"] = api_key

    client = AsyncOpenAI(
        base_url=settings.OPENAI_BASE_URL,
        api_key=api_key,
    )
    # Model name: strip dashscope/ prefix if present (e.g. "dashscope/qwen-plus" -> "qwen-plus")
    model_name = settings.DEFAULT_MODEL
    if "/" in model_name:
        model_name = model_name.split("/", 1)[1]

    return OpenAIChatCompletionsModel(
        model=model_name,
        openai_client=client,
    )


def create_agent(
    doc_client,
    doc_id: str,
    system_prompt: str,
    model: Optional[OpenAIChatCompletionsModel] = None,
) -> Agent:
    """Create Agent with document tools bound to a specific doc_id."""

    @function_tool
    def get_document() -> str:
        """Get document metadata: status, page count, name, and description."""
        return doc_client.get_document(doc_id)

    @function_tool
    def get_document_structure() -> str:
        """Get the document's full tree structure (without text) to find relevant sections."""
        return doc_client.get_document_structure(doc_id)

    @function_tool
    def get_page_content(pages: str) -> str:
        """Get the text content of specific pages. Use tight ranges: e.g. '5-7', '3,8', '12'."""
        return doc_client.get_page_content(doc_id, pages)

    if model is None:
        model = create_model()

    return Agent(
        name="PageIndex",
        instructions=system_prompt,
        tools=[get_document, get_document_structure, get_page_content],
        model=model,
    )


async def run_agent_with_guardrails(
    agent: Agent,
    query: str,
    max_turns: int = 5,
    timeout_seconds: int = 60,
) -> tuple[str, bool]:
    """Run agent with max_turns and timeout guardrails.

    Returns: (answer, is_fallback)
    """
    try:
        result = await asyncio.wait_for(
            Runner.run(agent, query, max_turns=max_turns),
            timeout=timeout_seconds,
        )
        return result.final_output or "", False
    except (asyncio.TimeoutError, Exception):
        return "", True
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/services/agent_service.py
git commit -m "feat: add agent service with tools, model creation, and guardrails"
```

---

## Task 5: 重写 ChatService 使用 Agent

**Files:**
- Modify: `backend/app/services/document_service.py:136-601`

- [ ] **Step 1: 替换整个 ChatService 类**

删除 `ChatService` 类（第 136-595 行），替换为：

```python
class ChatService:
    """Service for document-based chat using agentic reasoning-based retrieval."""

    def __init__(self, doc_service: DocumentService):
        self.doc_service = doc_service

    async def query_document(
        self,
        document: Document,
        query: str,
        chat_history: list = None,
    ) -> tuple[str, list]:
        """
        Query a document using Agent SDK.

        Returns: (answer, citations)
        """
        from app.services.prompt_service import get_active_prompt
        from app.services.system_config_service import get_config_int
        from app.services.agent_service import create_agent, run_agent_with_guardrails, create_model
        from litellm import completion as litellm_completion

        doc_structure = document.structure
        if not doc_structure:
            return "Document structure not available. Please reindex the document.", []

        # Build Agent system prompt from DB prompts
        agent_prompt = await get_active_prompt("agent_system")
        rag_template = await get_active_prompt("rag_template")
        if rag_template:
            agent_prompt = f"{agent_prompt}\n\n{rag_template}"

        # Add document context to prompt
        agent_prompt += f"\n\nDocument: {document.original_name}"
        if document.doc_description:
            agent_prompt += f"\nDescription: {document.doc_description}"
        if document.page_count:
            agent_prompt += f"\nPages: {document.page_count}"

        # Add chat history context
        if chat_history:
            history_text = "\n".join(
                f"{msg.get('role', 'user')}: {msg.get('content', '')}"
                for msg in chat_history[-5:]
            )
            agent_prompt += f"\n\nChat history:\n{history_text}"

        # Get agent guardrail params from DB
        max_turns = await get_config_int("agent_max_turns", 5)
        timeout_seconds = await get_config_int("agent_timeout_seconds", 60)

        # Create and run agent
        model = create_model()
        agent = create_agent(
            doc_client=self.doc_service.client,
            doc_id=document.id,
            system_prompt=agent_prompt,
            model=model,
        )

        answer, is_fallback = await run_agent_with_guardrails(
            agent=agent,
            query=query,
            max_turns=max_turns,
            timeout_seconds=timeout_seconds,
        )

        # Fallback: use structure summary + direct LLM call
        if is_fallback or not answer:
            answer = await self._fallback_query(document, query, agent_prompt)

        # Post-processing
        from app.services.prompt_service import get_active_prompt as get_pp
        answer = self._convert_latex_brackets(answer)
        answer = self._add_citation_markers(answer, document)
        citations = self._extract_citations(document, answer)

        return answer, citations

    async def _fallback_query(self, document: Document, query: str, system_prompt: str) -> str:
        """Fallback using structure summary + direct litellm call."""
        from litellm import completion as litellm_completion

        structure_summary = self._extract_structure_summary(document.structure)

        model = os.environ.get("DEFAULT_MODEL", settings.DEFAULT_MODEL)
        if os.environ.get("DASHSCOPE_API_KEY"):
            os.environ["OPENAI_API_KEY"] = os.environ.get("DASHSCOPE_API_KEY")

        try:
            response = litellm_completion(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Document Structure:\n{structure_summary}\n\nQuestion: {query}"}
                ],
                temperature=0.7,
                max_tokens=2000,
            )
            return response.choices[0].message.content
        except Exception as e:
            return f"Error processing question: {str(e)}"

    def _extract_structure_summary(self, structure, max_depth=2):
        """Extract a readable summary from document structure."""
        if not structure:
            return "No structure available"

        summary_lines = []

        def traverse(nodes, depth=0):
            if depth >= max_depth:
                return
            for node in nodes:
                title = node.get("title", "Untitled")
                node_type = node.get("type", "section")
                start = node.get("start_index", 0)
                end = node.get("end_index", 0)
                indent = "  " * depth
                summary_lines.append(f"{indent}- {title} ({node_type}, pages {start}-{end})")
                summary = node.get("summary", "")
                if summary and depth < max_depth - 1:
                    summary_lines.append(f"{indent}  Summary: {summary[:200]}...")
                if "nodes" in node and node["nodes"]:
                    traverse(node["nodes"], depth + 1)

        if isinstance(structure, list):
            traverse(structure)
        elif isinstance(structure, dict):
            traverse([structure])

        return "\n".join(summary_lines)

    def _convert_latex_brackets(self, answer):
        """Convert [ ... ] and \\[ ... \\] to $$ ... $$ for KaTeX rendering."""
        import re

        pattern1 = r'\\\[(.*?)\\\]'
        pattern2 = r'\[(\s*\\[a-zA-Z].*?)\]'

        def replace_bracket(match):
            content = match.group(1).strip()
            if re.match(r'^\d+$', content):
                return match.group(0)
            if content.startswith('第'):
                return match.group(0)
            if any(latex_cmd in content for latex_cmd in ['\\text', '\\frac', '\\sqrt', '\\sum', '\\int', '\\prod', '\\alpha', '\\beta', '\\gamma', '\\delta', '\\epsilon', '\\theta', '\\lambda', '\\mu', '\\pi', '\\sigma', '\\omega', '\\phi', '\\psi', '\\chi', '\\rho', '\\tau', '\\nu', '\\xi', '\\zeta', '\\eta', '\\kappa', '\\iota', '\\upsilon', '\\left', '\\right', '\\top', '\\softmax']):
                return f'$${content}$$'
            if re.search(r'\\[a-zA-Z]+', content) and ('=' in content or '(' in content):
                return f'$${content}$$'
            return match.group(0)

        answer = re.sub(pattern1, lambda m: f'$${m.group(1)}$$', answer)
        answer = re.sub(pattern2, replace_bracket, answer)
        return answer

    def _add_citation_markers(self, answer, document):
        """Add [1], [2] citation markers to answer if not present."""
        import re
        if re.search(r'\[\d+\]', answer):
            return answer
        # Simple fallback: no citations yet
        return answer

    def _extract_citations(self, document, answer=""):
        """Extract citation information from document pages."""
        import re
        citations = []
        if not document.pages:
            return citations

        # Find [X] citations in answer
        bracket_citations = re.findall(r'\[(\d+)\]', answer)
        page_numbers = []
        for page_data in document.pages:
            page_numbers.append(page_data.get("page", 0))

        if bracket_citations:
            for idx_str in bracket_citations[:3]:
                idx = int(idx_str) - 1
                if 0 <= idx < len(document.pages):
                    pd = document.pages[idx]
                    text = pd.get("content", "")[:2000]
                    citations.append({
                        "page": pd.get("page", idx + 1),
                        "text": text,
                        "node_title": f"Page {pd.get('page', idx + 1)}"
                    })
        elif document.pages:
            # No explicit citations, include first 3 pages
            for pd in document.pages[:3]:
                text = pd.get("content", "")[:2000]
                citations.append({
                    "page": pd.get("page", 0),
                    "text": text,
                    "node_title": f"Page {pd.get('page', 0)}"
                })

        return citations
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/services/document_service.py
git commit -m "feat: rewrite ChatService to use Agent SDK with fallback"
```

---

## Task 6: 前端类型和 API

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`

- [ ] **Step 1: 在 types/index.ts 末尾新增类型**

```typescript
export interface PromptConfig {
  id: string
  category: string
  name: string
  content: string
  version: number
  is_active: boolean
  description?: string
  created_at: string
}

export interface SystemConfig {
  key: string
  value: string
  description?: string
  updated_at: string
}
```

- [ ] **Step 2: 在 api.ts 末尾（`healthApi` 之后）新增 API**

```typescript
// Prompts
export const promptApi = {
  listAll: async (): Promise<Record<string, string>> => {
    const response = await api.get('/prompts')
    return response.data
  },

  get: async (category: string): Promise<{ category: string; content: string }> => {
    const response = await api.get(`/prompts/${category}`)
    return response.data
  },

  listVersions: async (category: string): Promise<PromptConfig[]> => {
    const response = await api.get(`/prompts/${category}/versions`)
    return response.data
  },

  create: async (category: string, name: string, content: string, description?: string): Promise<PromptConfig> => {
    const response = await api.post(`/prompts/${category}`, { name, content, description })
    return response.data
  },

  activate: async (category: string, promptId: string): Promise<void> => {
    await api.put(`/prompts/${category}/active/${promptId}`)
  },

  delete: async (category: string, promptId: string): Promise<void> => {
    await api.delete(`/prompts/${category}/versions/${promptId}`)
  },
}

// System Configs
export const systemConfigApi = {
  list: async (): Promise<SystemConfig[]> => {
    const response = await api.get('/system-configs')
    return response.data
  },

  update: async (key: string, value: string): Promise<SystemConfig> => {
    const response = await api.put(`/system-configs/${key}`, { value })
    return response.data
  },
}
```

- [ ] **Step 3: 在 api.ts 顶部 import 中添加新类型**

```typescript
import type { Document, DocumentUploadResponse, TreeNode, ChatSession, ChatMessage, Folder, PromptConfig, SystemConfig } from '@/types'
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts
git commit -m "feat: add prompt and system config frontend types and API"
```

---

## Task 7: 前端 — PromptConfig 页面

**Files:**
- Create: `frontend/src/pages/PromptConfig.tsx`

- [ ] **Step 1: 创建 PromptConfig.tsx 完整内容**

```tsx
import { useState, useEffect } from 'react'
import { Card, Tabs, Table, Button, Modal, Input, Form, Tag, Space, message, Popconfirm, Typography, Divider, InputNumber } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { promptApi, systemConfigApi } from '@/services/api'
import type { PromptConfig, SystemConfig } from '@/types'

const { Title, Text } = Typography
const { TextArea } = Input

const CATEGORIES = [
  { key: 'agent_system', label: 'Agent System', description: 'Agent 行为和工具使用策略' },
  { key: 'rag_template', label: 'RAG Template', description: 'RAG 问答答案格式要求' },
  { key: 'indexing', label: 'Indexing', description: '索引构建提示词' },
  { key: 'post_processing', label: 'Post-Processing', description: '后处理规则' },
]

const PromptConfigPage = () => {
  const [activeCategory, setActiveCategory] = useState('agent_system')
  const [versions, setVersions] = useState<PromptConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [editModalVisible, setEditModalVisible] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<PromptConfig | null>(null)
  const [form] = Form.useForm()

  // System configs
  const [configs, setConfigs] = useState<SystemConfig[]>([])
  const [configLoading, setConfigLoading] = useState(false)

  useEffect(() => {
    fetchVersions(activeCategory)
    fetchConfigs()
  }, [activeCategory])

  const fetchVersions = async (category: string) => {
    setLoading(true)
    try {
      const data = await promptApi.listVersions(category)
      setVersions(data)
    } catch {
      message.error('加载版本历史失败')
    } finally {
      setLoading(false)
    }
  }

  const fetchConfigs = async () => {
    setConfigLoading(true)
    try {
      const data = await systemConfigApi.list()
      setConfigs(data)
    } catch {
      message.error('加载配置失败')
    } finally {
      setConfigLoading(false)
    }
  }

  const handleCreate = () => {
    setEditingPrompt(null)
    form.resetFields()
    setEditModalVisible(true)
  }

  const handleEdit = (prompt: PromptConfig) => {
    setEditingPrompt(prompt)
    form.setFieldsValue({
      name: prompt.name,
      content: prompt.content,
      description: prompt.description,
    })
    setEditModalVisible(true)
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      await promptApi.create(activeCategory, values.name, values.content, values.description)
      message.success('新版本已创建并激活')
      setEditModalVisible(false)
      fetchVersions(activeCategory)
    } catch {
      message.error('保存失败')
    }
  }

  const handleActivate = async (promptId: string) => {
    try {
      await promptApi.activate(activeCategory, promptId)
      message.success('已切换版本')
      fetchVersions(activeCategory)
    } catch {
      message.error('切换失败')
    }
  }

  const handleDelete = async (promptId: string) => {
    try {
      await promptApi.delete(activeCategory, promptId)
      message.success('已删除')
      fetchVersions(activeCategory)
    } catch {
      message.error('删除失败')
    }
  }

  const handleConfigUpdate = async (key: string, value: string) => {
    try {
      await systemConfigApi.update(key, value)
      message.success('配置已更新')
      fetchConfigs()
    } catch {
      message.error('更新失败')
    }
  }

  const versionColumns = [
    {
      title: '版本',
      dataIndex: 'version',
      width: 80,
      render: (v: number) => `v${v}`,
    },
    {
      title: '名称',
      dataIndex: 'name',
    },
    {
      title: '说明',
      dataIndex: 'description',
      ellipsis: true,
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      width: 100,
      render: (active: boolean) =>
        active ? <Tag color="green" icon={<CheckCircleOutlined />}>当前</Tag> : <Tag>历史</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 180,
      render: (t: string) => new Date(t).toLocaleString(),
    },
    {
      title: '操作',
      width: 160,
      render: (_: unknown, record: PromptConfig) => (
        <Space>
          {!record.is_active && (
            <Button size="small" onClick={() => handleActivate(record.id)}>切换</Button>
          )}
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          {!record.is_active && (
            <Popconfirm title="确认删除？" onConfirm={() => handleDelete(record.id)}>
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  const configColumns = [
    { title: '参数', dataIndex: 'key', width: 220 },
    { title: '说明', dataIndex: 'description', width: 280 },
    {
      title: '当前值',
      dataIndex: 'value',
      render: (val: string, record: SystemConfig) => (
        <Space>
          {record.key.includes('turns') || record.key.includes('tokens') || record.key.includes('seconds') ? (
            <InputNumber
              value={parseInt(val)}
              min={1}
              max={record.key === 'agent_max_tokens' ? 8192 : 300}
              onChange={(v) => v !== null && handleConfigUpdate(record.key, String(v))}
              style={{ width: 120 }}
            />
          ) : (
            <Input
              value={val}
              onPressEnter={(e) => handleConfigUpdate(record.key, (e.target as HTMLInputElement).value)}
              style={{ width: 200 }}
            />
          )}
        </Space>
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: 180,
      render: (t: string) => new Date(t).toLocaleString(),
    },
  ]

  return (
    <div style={{ maxWidth: 1200 }}>
      <Title level={3}>系统配置</Title>

      <Tabs
        activeKey={activeCategory}
        onChange={setActiveCategory}
        items={[
          ...CATEGORIES.map(cat => ({
            key: cat.key,
            label: cat.label,
            children: (
              <>
                <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text type="secondary">{cat.description}</Text>
                  <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>新建版本</Button>
                </div>
                <Table
                  dataSource={versions}
                  columns={versionColumns}
                  rowKey="id"
                  loading={loading}
                  pagination={false}
                />
                {versions.find(v => v.is_active) && (
                  <Card title="当前生效内容" size="small" style={{ marginTop: 16 }}>
                    <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 13 }}>
                      {versions.find(v => v.is_active)?.content}
                    </pre>
                  </Card>
                )}
              </>
            ),
          })),
          {
            key: 'agent_params',
            label: 'Agent 参数',
            children: (
              <Table
                dataSource={configs}
                columns={configColumns}
                rowKey="key"
                loading={configLoading}
                pagination={false}
              />
            ),
          },
        ]}
      />

      <Modal
        title={editingPrompt ? `编辑 v${editingPrompt.version}` : '新建版本'}
        open={editModalVisible}
        onOk={handleSave}
        onCancel={() => setEditModalVisible(false)}
        width={800}
        okText="保存"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="content" label="内容" rules={[{ required: true, message: '请输入内容' }]}>
            <TextArea rows={16} style={{ fontFamily: 'monospace' }} />
          </Form.Item>
          <Form.Item name="description" label="变更说明">
            <Input placeholder="可选：描述本次变更" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default PromptConfigPage
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/PromptConfig.tsx
git commit -m "feat: add PromptConfig page with version management"
```

---

## Task 8: 前端路由和菜单集成

**Files:**
- Modify: `frontend/src/App.tsx:1-87`

- [ ] **Step 1: 在 App.tsx 中添加路由和菜单项**

导入新组件（在现有 import 行之后）：

```tsx
import PromptConfigPage from './pages/PromptConfig'
```

在 `menuItems` 数组中修改 Settings 项的 key：

```tsx
{
  key: '/settings',
  icon: <SettingOutlined />,
  label: 'Settings',
},
```

在 `<Routes>` 中替换 Settings 路由：

```tsx
<Route path="/settings" element={<PromptConfigPage />} />
```

- [ ] **Step 2: 验证前端能正常构建**

```bash
cd frontend && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: integrate PromptConfig page into app routing"
```

---

## Task 9: 验证完整流程

- [ ] **Step 1: 启动后端验证迁移**

```bash
cd backend && uv run alembic upgrade head
```

- [ ] **Step 2: 启动后端服务**

```bash
cd backend && uv run uvicorn app.main:app --reload
```

- [ ] **Step 3: 验证 API 端点**

```bash
# 获取所有提示词
curl http://localhost:8000/api/prompts

# 获取 Agent 参数
curl http://localhost:8000/api/system-configs

# 更新参数
curl -X PUT http://localhost:8000/api/system-configs/agent_max_turns -H 'Content-Type: application/json' -d '{"value":"3"}'
```

- [ ] **Step 4: 启动前端验证页面**

```bash
cd frontend && npm run dev
```

访问 http://localhost:5173/settings 验证提示词管理和 Agent 参数页面。

- [ ] **Step 5: 最终 Commit**

```bash
git add -A
git commit -m "feat: complete agentic refactor with prompt versioning"
```
