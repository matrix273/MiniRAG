"""Role and permission management service."""
from fastapi import HTTPException, status
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from app.models.user import User, Role, Permission, UserRole, RolePermission
from app.core.security import get_user_by_id


async def list_roles(db: AsyncSession) -> List[Role]:
    """List all roles."""
    result = await db.execute(select(Role))
    return list(result.scalars().all())


async def get_role(db: AsyncSession, role_id: str) -> Role:
    """Get a role by ID."""
    result = await db.execute(select(Role).where(Role.id == role_id))
    role = result.scalar_one_or_none()
    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role not found",
        )
    return role


async def create_role(db: AsyncSession, name: str, description: str = None) -> Role:
    """Create a new role."""
    # Check if role name already exists
    result = await db.execute(select(Role).where(Role.name == name))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Role name already exists",
        )

    role = Role(name=name, description=description, is_system=False)
    db.add(role)
    await db.commit()
    await db.refresh(role)
    return role


async def update_role(
    db: AsyncSession, role_id: str, name: str = None, description: str = None
) -> Role:
    """Update a role. System roles can't be renamed (only description can be changed)."""
    role = await get_role(db, role_id)

    if role.is_system and name and name != role.name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot rename system roles",
        )

    if name:
        # Check if new name already exists
        result = await db.execute(select(Role).where(Role.name == name))
        existing = result.scalar_one_or_none()
        if existing and existing.id != role_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Role name already exists",
            )
        role.name = name

    if description is not None:
        role.description = description

    await db.commit()
    await db.refresh(role)
    return role


async def delete_role(db: AsyncSession, role_id: str) -> None:
    """Delete a role. System roles can't be deleted."""
    role = await get_role(db, role_id)

    if role.is_system:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete system roles",
        )

    # Remove role from all users first
    await db.execute(delete(UserRole).where(UserRole.role_id == role_id))
    # Remove role-permission associations
    await db.execute(delete(RolePermission).where(RolePermission.role_id == role_id))
    # Delete the role
    await db.delete(role)
    await db.commit()


async def assign_permissions(
    db: AsyncSession, role_id: str, permission_names: List[str]
) -> Role:
    """Assign permissions to a role."""
    role = await get_role(db, role_id)

    # Clear existing permissions
    await db.execute(delete(RolePermission).where(RolePermission.role_id == role_id))

    # Add new permissions
    for perm_name in permission_names:
        result = await db.execute(select(Permission).where(Permission.name == perm_name))
        permission = result.scalar_one_or_none()
        if not permission:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Permission not found: {perm_name}",
            )

        role_perm = RolePermission(role_id=role_id, permission_id=permission.id)
        db.add(role_perm)

    await db.commit()
    await db.refresh(role)
    return role


async def assign_user_roles(
    db: AsyncSession, user_id: str, role_names: List[str]
) -> User:
    """Assign roles to a user."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # Clear existing roles
    await db.execute(delete(UserRole).where(UserRole.user_id == user_id))

    # Add new roles
    for role_name in role_names:
        result = await db.execute(select(Role).where(Role.name == role_name))
        role = result.scalar_one_or_none()
        if not role:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Role not found: {role_name}",
            )

        user_role = UserRole(user_id=user_id, role_id=role.id)
        db.add(user_role)

    await db.commit()
    # Refresh user to get updated roles
    user = await get_user_by_id(db, user_id)
    return user


async def list_users(db: AsyncSession) -> List[User]:
    """List all users."""
    result = await db.execute(select(User))
    return list(result.scalars().all())


async def list_permissions(db: AsyncSession) -> List[Permission]:
    """List all permissions."""
    result = await db.execute(select(Permission))
    return list(result.scalars().all())