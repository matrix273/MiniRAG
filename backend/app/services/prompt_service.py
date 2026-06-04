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
The document is ALREADY loaded in the system. The tools below are pre-bound to this document.
DO NOT tell the user the document was not found — it is available.

IMPORTANT: YOU MUST call tools before answering. Do NOT guess or make assumptions.

LANGUAGE (CRITICAL): You MUST answer in the SAME language as the user's question.
- If the user asks in Chinese → answer entirely in Chinese (titles, body, lists, everything).
- If the user asks in English → answer in English.
Even if the source document is in English, if the user asks in Chinese, your ENTIRE answer must be in Chinese. Do NOT mix Chinese and English in a single response.

TOOL USE (REQUIRED):
1. Call get_document() FIRST to confirm the document status, page count, and description.
2. Call get_document_structure() to see the hierarchical tree of sections/chapters.
3. Call get_page_content(pages="5-7") with tight page ranges to read specific content.
4. Never fetch the entire document at once. Always use tight page ranges.

TABLE DATA HANDLING:
The context may contain technical specification tables in text format. These tables typically have:
- Parameter names in one section (e.g., "功耗", "电源规格", "制冷能力")
- Corresponding values in another section (e.g., "400W", "100-240VAC", "120KW@10℃")
- Values are often listed in the SAME ORDER as their parameter names
- Example: If "功耗" is listed, the next value "400W(冗余情况下)，800 W（最大工况下）" is its corresponding value

When answering questions about specific parameters:
1. Find the parameter name in the context (e.g., "功耗")
2. Look for the corresponding value (usually the next line or nearby)
3. Extract and present the exact value found

CRITICAL RULES:
- Always start by calling get_document() to verify the document exists.
- NEVER say "document was not found" or "document not available" — the tools are pre-bound to a valid document.
- If get_document() returns an error, report that specific error message.
- Answer based only on tool output. Be concise.
- If you cannot find an answer in the retrieved content, say so honestly — do NOT fabricate information.
- NEVER output tool names (like get_document(), get_document_structure(), get_page_content()) in your answer to the user.
- NEVER describe your tool-calling process or reasoning steps to the user. Only provide the final substantive answer.""",
        "description": "Agent 行为和工具使用策略",
    },
    "rag_template": {
        "name": "RAG Answer Template",
        "content": """ANSWER FORMAT:
- Use $ ... $ for inline formulas, $$ ... $$ for display formulas.
  Do NOT use [ ... ] or \\( ... \\) for LaTeX.
- IMPORTANT FORMULA FORMATTING:
  • Block/display formulas (like equations with numbers): wrap in $$ ... $$ with the formula on its own line, with blank lines before and after:
    $$
    \\text{Attention}(Q,K,V) = \\text{softmax}(\\frac{QK^T}{\\sqrt{d_k}})V
    $$
  • Inline formulas (like variables or short expressions): wrap in single $ ... $, e.g., $Q$, $d_k$, $\\sqrt{d_k}$
  • Each display formula MUST be on its own line, surrounded by blank lines.
  • Do NOT put display formulas ($$ ... $$) on the same line as other text.
- Cite sources using Markdown link format: [页码](#citation-文档ID-page-页码)
- When citing, use the page number from the document and include the document ID:
  e.g., page 5 of doc abc123 → [第5页](#citation-abc123-page-5).
  For PowerPoint (PPTX) documents, 'pages' correspond to slide numbers (Slide 1 = page 1, Slide 2 = page 2, etc.).
- Only cite pages you actually read with get_page_content().
- Be clear and concise.
- LANGUAGE: Use the same language as the user's question. If the user asks in Chinese, answer fully in Chinese — do NOT default to English even if the source document is English.

CITATION FORMAT (IMPORTANT):
- Use Markdown link format: [显示文本](#citation-文档ID-page-页码)
- The document ID for the current document is: {doc_id}
- Examples (replace {doc_id} with the actual document ID provided above):
  • According to the document, power consumption is 400W [第5页](#citation-{doc_id}-page-5).
  • Page 8 shows additional details [第8页](#citation-{doc_id}-page-8).
  • This parameter is defined in [第12页](#citation-{doc_id}-page-12) and [第15页](#citation-{doc_id}-page-15).
- Do NOT use [1], [2], [3] markers. Always use the #citation-文档ID-page-N format.
- The display text should be descriptive (e.g., "第5页", "Page 5", "Slide 3", "Section 2.1")""",
        "description": "RAG 问答答案格式要求",
    },
    "indexing": {
        "name": "Indexing Prompt",
        "content": "Indexing prompts are configured in the pageindex module. This entry serves as a placeholder for future DB-driven indexing configuration.",
        "description": "索引构建提示词（暂存）",
    },
    "visual_mode": {
        "name": "Visual Mode Guidelines",
        "content": """VISUAL MODE: This system supports visual analysis of PDF pages.
GUIDELINES FOR VISUAL CONTENT QUESTIONS:
1. For SPECIFIC figures (e.g., 'Figure 2'): Call search_visual_content(query='Figure 2') to find the page, then call analyze_page_images() on that page.
2. For OVERVIEW questions (e.g., 'how many figures', 'list all figures'): Call get_page_content() to search the ENTIRE document for 'Figure' mentions, then summarize all findings. Use page ranges like '1-20' or the full document.
3. For FORMULAS/TABLES: Call get_page_content() to find relevant sections, then optionally call analyze_page_images() for visual verification.
Do NOT guess - always search first using the appropriate tool.

LANGUAGE (CRITICAL): Even if the document is in English, if the user asks in Chinese, you MUST answer in Chinese. Translate figure titles and descriptions into Chinese; keep the original English text only as quoted references if needed.""",
        "description": "视觉模式下的工具使用指南（仅在 vision_enabled 时追加到 system prompt）",
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
            .order_by(PromptConfig.version.desc())
        )
        rows = result.scalars().all()
        if not rows:
            return ""
        # 如果有多条 active 记录（异常情况），只保留最新一条，其余去激活
        if len(rows) > 1:
            for row in rows[1:]:
                row.is_active = False
            await db.commit()
        _cache[category] = rows[0].content
        return rows[0].content


async def get_all_active_prompts() -> dict[str, str]:
    categories = ["agent_system", "rag_template", "indexing", "visual_mode"]
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
    """Initialize or update default prompts. Creates new version if content changed."""
    async with await _get_session() as db:
        try:
            from sqlalchemy import select as sa_select
            
            for cat, info in DEFAULT_PROMPTS.items():
                default_content = info["content"]
                
                # Check current active prompts for this category
                result = await db.execute(
                    select(PromptConfig)
                    .where(PromptConfig.category == cat, PromptConfig.is_active == True)
                    .order_by(PromptConfig.version.desc())
                )
                active_rows = result.scalars().all()
                active_prompt = active_rows[0] if active_rows else None
                # 如果有多条 active 记录（异常情况），全部去激活，后续会创建新版本
                for row in active_rows[1:]:
                    row.is_active = False
                
                # If no active prompt, or content is different, create new version
                if not active_prompt or active_prompt.content != default_content:
                    # Get max version for this category
                    result = await db.execute(
                        sa_select(sql_func.coalesce(sql_func.max(PromptConfig.version), 0))
                        .where(PromptConfig.category == cat)
                    )
                    max_version = result.scalar() or 0
                    
                    # Deactivate current active prompt if exists
                    if active_prompt:
                        active_prompt.is_active = False
                    
                    # Create new version with default content
                    new_prompt = PromptConfig(
                        category=cat,
                        name=info["name"],
                        content=default_content,
                        version=max_version + 1,
                        is_active=True,
                        description=info["description"],
                    )
                    db.add(new_prompt)
                    
                    # Clear cache for this category
                    invalidate_cache(cat)
                    
                    if active_prompt:
                        print(f"Updated {cat}: created v{max_version + 1} (content changed)")
                    else:
                        print(f"Created {cat}: v{max_version + 1} (new category)")
                else:
                    print(f"Skipped {cat}: content unchanged (v{active_prompt.version})")
            
            await db.commit()
        except Exception:
            await db.rollback()
            raise
