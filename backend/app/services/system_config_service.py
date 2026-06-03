"""System configuration key-value store service."""

import os
from dotenv import load_dotenv
from sqlalchemy import select

load_dotenv()
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import sessionmaker
from app.models.database import SystemConfig, engine

_cache: dict[str, str] = {}

DEFAULT_CONFIGS = {
    "agent_max_turns": {"value": "5", "description": "Agent 最大 tool call 轮数"},
    "agent_max_tokens": {"value": "2048", "description": "单次 LLM 回答最大 token 数"},
    "agent_timeout_seconds": {"value": "60", "description": "Agent 整体超时秒数"},
    # LLM 配置
    "llm_default_model": {"value": "dashscope/qwen-plus", "description": "默认 LLM 模型 (LiteLLM 格式)"},
    "llm_vision_model": {"value": "dashscope/qwen-vl-plus", "description": "视觉 LLM 模型"},
    "llm_vision_enabled": {"value": "false", "description": "是否启用视觉功能 (true/false)"},
    "llm_api_base_url": {"value": "https://dashscope.aliyuncs.com/compatible-mode/v1", "description": "API 基础 URL"},
    "llm_dashscope_key": {"value": "", "description": "DashScope API Key"},
    "llm_openai_key": {"value": "", "description": "OpenAI API Key (可选)"},
}


_session_factory = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def _get_session() -> AsyncSession:
    return _session_factory()


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
        rows = result.scalars().all()
        # 在 session 关闭前把数据取出，避免 DetachedInstanceError
        return [
            {
                "key": row.key,
                "value": row.value,
                "description": row.description,
                "updated_at": row.updated_at,
            }
            for row in rows
        ]


async def update_config(key: str, value: str):
    async with await _get_session() as db:
        try:
            result = await db.execute(select(SystemConfig).where(SystemConfig.key == key))
            row = result.scalar_one_or_none()
            if row:
                row.value = value
            else:
                row = SystemConfig(key=key, value=value)
                db.add(row)
            await db.commit()
            # 刷新以获取服务端默认值（如 updated_at），在 session 内取出数据
            await db.refresh(row)
            invalidate_cache(key)
            return {
                "key": row.key,
                "value": row.value,
                "description": row.description,
                "updated_at": row.updated_at,
            }
        except Exception:
            await db.rollback()
            raise


async def init_default_configs():
    async with await _get_session() as db:
        try:
            result = await db.execute(select(SystemConfig))
            existing = {row.key for row in result.scalars().all()}
            for key, info in DEFAULT_CONFIGS.items():
                if key not in existing:
                    db.add(SystemConfig(key=key, value=info["value"], description=info["description"]))
            await db.commit()
        except Exception:
            await db.rollback()
            raise


async def get_llm_config() -> dict:
    """获取 LLM 配置，从数据库实时读取，回退到环境变量"""
    return {
        "default_model": await get_config("llm_default_model") or DEFAULT_CONFIGS["llm_default_model"]["value"],
        "vision_model": await get_config("llm_vision_model") or DEFAULT_CONFIGS["llm_vision_model"]["value"],
        "vision_enabled": (await get_config("llm_vision_enabled") or DEFAULT_CONFIGS["llm_vision_enabled"]["value"]).lower() == "true",
        "api_base_url": await get_config("llm_api_base_url") or DEFAULT_CONFIGS["llm_api_base_url"]["value"],
        "dashscope_key": await get_config("llm_dashscope_key") or os.environ.get("DASHSCOPE_API_KEY") or "",
        "openai_key": await get_config("llm_openai_key") or os.environ.get("OPENAI_API_KEY") or "",
    }
