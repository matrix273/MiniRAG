"""Authentication schemas for request/response validation."""
from pydantic import BaseModel, EmailStr, ConfigDict
from datetime import datetime
from typing import List


class RegisterRequest(BaseModel):
    """User registration request."""
    email: EmailStr
    username: str
    password: str


class LoginRequest(BaseModel):
    """User login request (email or username)."""
    email: str
    password: str


class TokenResponse(BaseModel):
    """Token response after authentication."""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    """Refresh token request."""
    refresh_token: str


class UserResponse(BaseModel):
    """User information response."""
    id: str
    email: str
    username: str
    is_active: bool
    created_at: datetime
    roles: List[str] = []
    permissions: List[str] = []

    model_config = ConfigDict(from_attributes=True)


class ChangePasswordRequest(BaseModel):
    """Change password request."""
    old_password: str
    new_password: str
