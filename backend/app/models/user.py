import uuid
from datetime import datetime
from typing import Optional, List

from sqlalchemy import (
    String,
    DateTime,
    Text,
    ForeignKey,
    UniqueConstraint,
    Boolean,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.models.base import Base


class User(Base):
    """User model for authentication and authorization."""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    email: Mapped[str] = mapped_column(
        String(255), unique=True, index=True, nullable=False
    )
    username: Mapped[str] = mapped_column(
        String(100), unique=True, index=True, nullable=False
    )
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), onupdate=func.now(), server_default=func.now()
    )

    # Relationships
    roles: Mapped[List["Role"]] = relationship(
        secondary="user_roles",
        back_populates="users",
        lazy="selectin",
    )


class Role(Base):
    """Role model for RBAC."""

    __tablename__ = "roles"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_system: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    users: Mapped[List["User"]] = relationship(
        secondary="user_roles",
        back_populates="roles",
        lazy="selectin",
    )
    permissions: Mapped[List["Permission"]] = relationship(
        secondary="role_permissions",
        back_populates="roles",
        lazy="selectin",
    )


class Permission(Base):
    """Permission model for fine-grained access control."""

    __tablename__ = "permissions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    resource: Mapped[str] = mapped_column(String(100), nullable=False)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("resource", "action", name="uq_permission_resource_action"),
    )

    # Relationships
    roles: Mapped[List["Role"]] = relationship(
        secondary="role_permissions",
        back_populates="permissions",
        lazy="selectin",
    )


class UserRole(Base):
    """Association table for User-Role many-to-many."""

    __tablename__ = "user_roles"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True
    )


class RolePermission(Base):
    """Association table for Role-Permission many-to-many."""

    __tablename__ = "role_permissions"

    role_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True
    )
    permission_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True
    )


class RefreshToken(Base):
    """Refresh token for JWT authentication."""

    __tablename__ = "refresh_tokens"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_revoked: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
