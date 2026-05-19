from pydantic import BaseModel
from typing import Optional


class RoleCreate(BaseModel):
    name: str
    description: Optional[str] = None


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class RoleResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    is_system: bool
    permissions: list[str] = []

    class Config:
        from_attributes = True


class AssignRoleRequest(BaseModel):
    role_names: list[str]


class AssignPermissionsRequest(BaseModel):
    permission_names: list[str]


class UserListResponse(BaseModel):
    id: str
    email: str
    username: str
    is_active: bool
    roles: list[str] = []

    class Config:
        from_attributes = True