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
        return result.scalars().all()


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
            invalidate_cache(key)
            return row
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
