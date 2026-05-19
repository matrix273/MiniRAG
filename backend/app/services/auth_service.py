"""Authentication service for user registration, login, and token management."""
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, Role, Permission, UserRole, RolePermission
from app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_token,
    store_refresh_token,
    revoke_all_user_tokens,
    get_user_by_id,
)


# Permission definitions
ALL_PERMISSIONS = [
    ("auth", "login"),
    ("auth", "logout"),
    ("auth", "refresh"),
    ("user", "read"),
    ("user", "update"),
    ("user", "delete"),
    ("role", "create"),
    ("role", "read"),
    ("role", "update"),
    ("role", "delete"),
    ("role", "assign"),
    ("permission", "read"),
    ("document", "create"),
    ("document", "read"),
    ("document", "update"),
    ("document", "delete"),
    ("folder", "create"),
    ("folder", "read"),
    ("folder", "update"),
    ("folder", "delete"),
    ("chat", "create"),
    ("chat", "read"),
    ("chat", "delete"),
]


async def seed_roles_and_permissions(db: AsyncSession) -> None:
    """Seed default roles and permissions."""
    # Check if roles already exist
    result = await db.execute(select(Role).where(Role.name == "admin"))
    if result.scalar_one_or_none():
        return  # Already seeded

    # Create permissions
    permission_map = {}
    for resource, action in ALL_PERMISSIONS:
        name = f"{resource}.{action}"
        perm = Permission(
            name=name,
            resource=resource,
            action=action,
        )
        db.add(perm)
        await db.flush()
        permission_map[name] = perm

    # Create admin role with all permissions
    admin_role = Role(
        name="admin",
        description="Administrator with full access",
        is_system=True,
    )
    db.add(admin_role)
    await db.flush()

    # Assign all permissions to admin
    for perm_name, perm in permission_map.items():
        role_perm = RolePermission(role_id=admin_role.id, permission_id=perm.id)
        db.add(role_perm)

    # Create user role
    user_role = Role(
        name="user",
        description="Regular user with standard access",
        is_system=True,
    )
    db.add(user_role)
    await db.flush()

    # Assign user permissions: auth.*, document.*, folder.*, chat.*
    user_permission_prefixes = ["auth.", "document.", "folder.", "chat."]
    for perm_name, perm in permission_map.items():
        if any(perm_name.startswith(prefix) for prefix in user_permission_prefixes):
            role_perm = RolePermission(role_id=user_role.id, permission_id=perm.id)
            db.add(role_perm)

    # Create guest role
    guest_role = Role(
        name="guest",
        description="Guest user with limited access",
        is_system=True,
    )
    db.add(guest_role)
    await db.flush()

    # Assign guest permissions: auth.login, document.read, folder.read
    guest_permissions = ["auth.login", "document.read", "folder.read"]
    for perm_name in guest_permissions:
        if perm_name in permission_map:
            role_perm = RolePermission(role_id=guest_role.id, permission_id=permission_map[perm_name].id)
            db.add(role_perm)

    await db.commit()


async def register_user(
    db: AsyncSession,
    email: str,
    username: str,
    password: str,
) -> User:
    """Register a new user."""
    # Check if email or username already exists
    existing_email = await db.execute(select(User).where(User.email == email))
    if existing_email.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    existing_username = await db.execute(select(User).where(User.username == username))
    if existing_username.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already taken",
        )

    # Get user role
    result = await db.execute(select(Role).where(Role.name == "user"))
    user_role = result.scalar_one_or_none()
    if not user_role:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="User role not found. Run seed_roles_and_permissions first.",
        )

    # Create user
    hashed_password = hash_password(password)
    user = User(
        email=email,
        username=username,
        hashed_password=hashed_password,
        is_active=True,
    )
    db.add(user)
    await db.flush()

    # Assign user role
    user_role_assoc = UserRole(user_id=user.id, role_id=user_role.id)
    db.add(user_role_assoc)
    await db.commit()

    return user


async def authenticate_user(
    db: AsyncSession,
    email_or_username: str,
    password: str,
) -> tuple[str, str]:
    """Authenticate user by email or username.
    Returns (access_token, refresh_token)."""
    # Find user by email or username
    result = await db.execute(
        select(User).where(
            (User.email == email_or_username) | (User.username == email_or_username)
        )
    )
    user = result.scalar_one_or_none()

    if not user or not verify_password(password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled",
        )

    # Create tokens
    access_token = create_access_token(user.id)
    refresh_token, _ = create_refresh_token(user.id)

    # Store refresh token
    await store_refresh_token(db, user.id, refresh_token)
    await db.commit()

    return access_token, refresh_token


async def refresh_tokens(db: AsyncSession, token: str) -> tuple[str, str]:
    """Refresh access token using refresh token. Rotates refresh token.
    Returns (access_token, refresh_token)."""
    payload = decode_token(token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    user_id = payload.get("sub")
    token_hash = hash_token(token)

    # Check if token is revoked
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.user_id == user_id,
            RefreshToken.token_hash == token_hash,
        )
    )
    stored_token = result.scalar_one_or_none()

    if not stored_token or stored_token.is_revoked:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token revoked or not found",
        )

    # Revoke old refresh token
    stored_token.is_revoked = True
    await db.flush()

    # Create new tokens
    new_access_token = create_access_token(user_id)
    new_refresh_token, _ = create_refresh_token(user_id)

    # Store new refresh token
    await store_refresh_token(db, user_id, new_refresh_token)
    await db.commit()

    return new_access_token, new_refresh_token


async def logout_user(db: AsyncSession, user_id: str) -> None:
    """Logout user by revoking all refresh tokens."""
    await revoke_all_user_tokens(db, user_id)
    await db.commit()
