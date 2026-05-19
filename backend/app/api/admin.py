"""Admin API routes for role and user management."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from app.models.database import get_db
from app.core.deps import require_permission
from app.models.user import User
from app.schemas.admin import (
    RoleCreate,
    RoleUpdate,
    RoleResponse,
    AssignPermissionsRequest,
    AssignRoleRequest,
    UserListResponse,
)
from app.services import role_service


router = APIRouter(prefix="/api/admin", tags=["管理"])


@router.get("/roles", response_model=List[RoleResponse])
async def list_roles(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("role", "read")),
) -> List[RoleResponse]:
    """List all roles. Requires role.read permission."""
    roles = await role_service.list_roles(db)
    return [
        RoleResponse(
            id=role.id,
            name=role.name,
            description=role.description,
            is_system=role.is_system,
            permissions=[perm.name for perm in role.permissions],
        )
        for role in roles
    ]


@router.post("/roles", response_model=RoleResponse, status_code=status.HTTP_201_CREATED)
async def create_role(
    request: RoleCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("role", "create")),
) -> RoleResponse:
    """Create a new role. Requires role.create permission."""
    role = await role_service.create_role(db, request.name, request.description)
    return RoleResponse(
        id=role.id,
        name=role.name,
        description=role.description,
        is_system=role.is_system,
        permissions=[],
    )


@router.put("/roles/{role_id}", response_model=RoleResponse)
async def update_role(
    role_id: str,
    request: RoleUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("role", "update")),
) -> RoleResponse:
    """Update a role. Requires role.update permission. System roles cannot be renamed."""
    role = await role_service.update_role(db, role_id, request.name, request.description)
    return RoleResponse(
        id=role.id,
        name=role.name,
        description=role.description,
        is_system=role.is_system,
        permissions=[perm.name for perm in role.permissions],
    )


@router.delete("/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(
    role_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("role", "delete")),
) -> None:
    """Delete a role. Requires role.delete permission. System roles cannot be deleted."""
    await role_service.delete_role(db, role_id)


@router.post("/roles/{role_id}/permissions", response_model=RoleResponse)
async def assign_permissions(
    role_id: str,
    request: AssignPermissionsRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("role", "assign")),
) -> RoleResponse:
    """Assign permissions to a role. Requires role.assign permission."""
    role = await role_service.assign_permissions(db, role_id, request.permission_names)
    return RoleResponse(
        id=role.id,
        name=role.name,
        description=role.description,
        is_system=role.is_system,
        permissions=[perm.name for perm in role.permissions],
    )


@router.get("/users", response_model=List[UserListResponse])
async def list_users(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("user", "read")),
) -> List[UserListResponse]:
    """List all users. Requires user.read permission."""
    users = await role_service.list_users(db)
    return [
        UserListResponse(
            id=u.id,
            email=u.email,
            username=u.username,
            is_active=u.is_active,
            roles=[role.name for role in u.roles],
        )
        for u in users
    ]


@router.put("/users/{user_id}/roles")
async def assign_user_roles(
    user_id: str,
    request: AssignRoleRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("role", "assign")),
):
    """Assign roles to a user. Requires role.assign permission."""
    updated_user = await role_service.assign_user_roles(db, user_id, request.role_names)
    return {
        "id": updated_user.id,
        "email": updated_user.email,
        "username": updated_user.username,
        "is_active": updated_user.is_active,
        "roles": [role.name for role in updated_user.roles],
    }


@router.get("/permissions")
async def list_permissions(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("permission", "read")),
):
    """List all permissions. Requires permission.read permission."""
    permissions = await role_service.list_permissions(db)
    return [
        {
            "id": perm.id,
            "name": perm.name,
            "resource": perm.resource,
            "action": perm.action,
            "description": perm.description,
        }
        for perm in permissions
    ]