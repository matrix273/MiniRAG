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


_session_factory = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def _get_session() -> AsyncSession:
    return _session_factory()


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
        try:
            result = await db.execute(
                select(sql_func.coalesce(sql_func.max(PromptConfig.version), 0))
                .where(PromptConfig.category == category)
            )
            max_version = result.scalar() or 0

            current = await db.execute(
                select(PromptConfig)
                .where(PromptConfig.category == category, PromptConfig.is_active == True)
            )
            for row in current.scalars().all():
                row.is_active = False

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
        except Exception:
            await db.rollback()
            raise


async def activate_prompt(category: str, prompt_id: str):
    async with await _get_session() as db:
        try:
            result = await db.execute(
                select(PromptConfig)
                .where(PromptConfig.category == category, PromptConfig.is_active == True)
            )
            for row in result.scalars().all():
                row.is_active = False

            target = await db.execute(
                select(PromptConfig).where(PromptConfig.id == prompt_id)
            )
            prompt = target.scalar_one_or_none()
            if prompt:
                prompt.is_active = True
                await db.commit()
                invalidate_cache(category)
            return prompt
        except Exception:
            await db.rollback()
            raise


async def delete_prompt(prompt_id: str):
    async with await _get_session() as db:
        try:
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
        except Exception:
            await db.rollback()
            raise


async def init_default_prompts():
    """Insert default prompts if table is empty."""
    async with await _get_session() as db:
        try:
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
        except Exception:
            await db.rollback()
            raise
