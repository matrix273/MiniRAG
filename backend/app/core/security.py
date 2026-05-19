"""Security utilities for authentication and authorization."""
import uuid
import hashlib
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.user import User, RefreshToken


def hash_password(password: str) -> str:
    """Hash password using bcrypt with cost factor 12."""
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')


def verify_password(password: str, hashed: str) -> bool:
    """Verify password against bcrypt hash."""
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))


def create_access_token(user_id: str) -> str:
    """Create JWT access token with 15-minute expiry."""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES_JWT)
    payload = {
        "sub": user_id,
        "exp": expire,
        "iat": now,
        "type": "access",
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> tuple[str, str]:
    """Create JWT refresh token with 7-day expiry and jti.
    Returns (token, jti)."""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    expire = now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    jti = str(uuid.uuid4())
    payload = {
        "sub": user_id,
        "exp": expire,
        "iat": now,
        "type": "refresh",
        "jti": jti,
    }
    token = jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return token, jti


def decode_token(token: str) -> dict | None:
    """Decode and validate JWT token. Returns payload or None if invalid."""
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def hash_token(token: str) -> str:
    """Hash token using SHA-256 for storing refresh tokens."""
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


async def store_refresh_token(db: AsyncSession, user_id: str, token: str) -> RefreshToken:
    """Store refresh token in database."""
    settings = get_settings()
    token_hash = hash_token(token)
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

    refresh_token = RefreshToken(
        user_id=user_id,
        token_hash=token_hash,
        expires_at=expires_at,
        is_revoked=False,
    )
    db.add(refresh_token)
    await db.flush()
    return refresh_token


async def revoke_refresh_token(db: AsyncSession, token_hash: str) -> bool:
    """Revoke a refresh token by its hash. Returns True if revoked."""
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.is_revoked == False
        )
    )
    token = result.scalar_one_or_none()
    if token:
        token.is_revoked = True
        await db.flush()
        return True
    return False


async def revoke_all_user_tokens(db: AsyncSession, user_id: str) -> None:
    """Revoke all refresh tokens for a user."""
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.user_id == user_id,
            RefreshToken.is_revoked == False
        )
    )
    tokens = result.scalars().all()
    for token in tokens:
        token.is_revoked = True
    await db.flush()


async def get_user_by_id(db: AsyncSession, user_id: str) -> User | None:
    """Get user by ID."""
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()
