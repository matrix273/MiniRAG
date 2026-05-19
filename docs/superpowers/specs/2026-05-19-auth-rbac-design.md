# PageIndex 认证授权系统设计文档

## 1. 概述

为 PageIndex 系统添加完整的认证授权功能，包括：
- 公共门户页（Landing Page）
- 用户注册/登录
- 基于角色的访问控制（RBAC）

## 2. 技术选型

| 组件 | 方案 |
|------|------|
| 认证 | JWT + Refresh Token |
| 密码 | bcrypt |
| 权限模型 | 自定义 RBAC |
| 前端状态 | React Context |

## 3. 数据模型

### 3.1 用户表 (users)

```sql
CREATE TABLE users (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 3.2 角色表 (roles)

```sql
CREATE TABLE roles (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    description VARCHAR(255),
    is_system BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 3.3 权限表 (permissions)

```sql
CREATE TABLE permissions (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    resource VARCHAR(50) NOT NULL,
    action VARCHAR(50) NOT NULL,
    description VARCHAR(255),
    UNIQUE(resource, action)
);
```

### 3.4 用户-角色关联表 (user_roles)

```sql
CREATE TABLE user_roles (
    user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
    role_id VARCHAR(36) REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);
```

### 3.5 角色-权限关联表 (role_permissions)

```sql
CREATE TABLE role_permissions (
    role_id VARCHAR(36) REFERENCES roles(id) ON DELETE CASCADE,
    permission_id VARCHAR(36) REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);
```

### 3.6 Refresh Token 黑名单 (refresh_tokens)

```sql
CREATE TABLE refresh_tokens (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_revoked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## 4. 权限清单

| 资源 | 操作 | 说明 |
|------|------|------|
| auth | login | 登录 |
| auth | logout | 登出 |
| auth | refresh | 刷新token |
| user | read | 查看用户 |
| user | update | 更新用户 |
| user | delete | 删除用户 |
| role | create | 创建角色 |
| role | read | 查看角色 |
| role | update | 更新角色 |
| role | delete | 删除角色 |
| role | assign | 分配角色 |
| permission | read | 查看权限 |
| document | create | 创建文档 |
| document | read | 查看文档 |
| document | update | 更新文档 |
| document | delete | 删除文档 |
| folder | create | 创建文件夹 |
| folder | read | 查看文件夹 |
| folder | update | 更新文件夹 |
| folder | delete | 删除文件夹 |
| chat | create | 创建聊天 |
| chat | read | 查看聊天 |
| chat | delete | 删除聊天 |

## 5. 角色定义

### 5.1 admin（系统管理员）

- 权限：全部
- 可管理用户和角色
- 系统内置角色，不可删除

### 5.2 user（普通用户）

- 权限：auth.*, document.*, folder.*, chat.*
- 可管理自己的文档和聊天

### 5.3 guest（访客）

- 权限：auth.login, document.read, folder.read
- 只读访问

## 6. API 设计

### 6.1 认证相关

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| /auth/register | POST | Public | 注册 |
| /auth/login | POST | Public | 登录 |
| /auth/refresh | POST | Public | 刷新token |
| /auth/logout | POST | JWT | 登出 |
| /auth/me | GET | JWT | 当前用户信息 |

### 6.2 管理员相关

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| /admin/roles | GET | JWT + admin | 角色列表 |
| /admin/roles | POST | JWT + admin | 创建角色 |
| /admin/roles/{id} | PUT | JWT + admin | 更新角色 |
| /admin/roles/{id} | DELETE | JWT + admin | 删除角色 |
| /admin/roles/{id}/permissions | POST | JWT + admin | 分配权限 |
| /admin/users/{id}/roles | PUT | JWT + admin | 分配角色 |

## 7. 前端页面

| 页面 | 路由 | 权限 | 说明 |
|------|------|------|------|
| 门户页 | / | Public | 着陆页 |
| 登录 | /login | Public | 登录表单 |
| 注册 | /register | Public | 注册表单 |
| 首页 | /home | JWT | 系统首页 |
| 文档 | /documents | JWT | 文档管理 |
| 管理后台 | /admin/* | admin | 用户/角色管理 |

## 8. 认证流程

### 8.1 注册流程

1. 用户填写邮箱、用户名、密码
2. 后端验证邮箱/用户名唯一性
3. 密码 bcrypt 加密存储
4. 默认分配 `user` 角色
5. 返回登录页

### 8.2 登录流程

1. 用户输入邮箱/用户名 + 密码
2. 后端验证凭据
3. 生成 access_token（15分钟） + refresh_token（7天）
4. refresh_token 存入数据库
5. 返回 tokens

### 8.3 Token 刷新流程

1. access_token 过期后，用 refresh_token 请求新 token
2. 验证 refresh_token 有效且未被撤销
3. 生成新的 access_token + refresh_token
4. 撤销旧的 refresh_token（rotate）

### 8.4 登出流程

1. 撤销用户的 refresh_token
2. 前端清除本地 tokens

## 9. 实现要点

### 9.1 后端

- 新增 `auth` 路由模块
- 新增 `admin` 路由模块
- 新增 `middleware` 验证 JWT
- 新增 `permissions` 依赖注入检查权限
- 使用 Alembic 管理数据库迁移
- 初始化脚本创建默认角色和权限

### 9.2 前端

- 新增 `pages/LandingPage.tsx` - 门户页
- 新增 `pages/Login.tsx` - 登录页
- 新增 `pages/Register.tsx` - 注册页
- 新增 `pages/admin/` - 管理后台页面
- 新增 `contexts/AuthContext.tsx` - 认证状态管理
- 新增 `hooks/useAuth.ts` - 认证相关 hook
- 更新路由配置，添加受保护路由

## 10. 安全考虑

- 密码使用 bcrypt 加密，cost factor = 12
- Access Token 短期有效（15分钟）
- Refresh Token 支持撤销（存数据库）
- CORS 配置限制来源
- 输入验证防止 SQL 注入和 XSS
