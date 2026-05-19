import api from './api'
import type { User, LoginRequest, RegisterRequest, AuthResponse, Role } from '@/types'

export const authApi = {
  register: async (data: RegisterRequest): Promise<User> => {
    const response = await api.post('/auth/register', data)
    return response.data
  },

  login: async (data: LoginRequest): Promise<AuthResponse> => {
    const response = await api.post('/auth/login', data)
    return response.data
  },

  refresh: async (refreshToken: string): Promise<AuthResponse> => {
    const response = await api.post('/auth/refresh', { refresh_token: refreshToken })
    return response.data
  },

  logout: async (): Promise<void> => {
    await api.post('/auth/logout')
  },

  me: async (): Promise<User> => {
    const response = await api.get('/auth/me')
    return response.data
  },

  changePassword: async (oldPassword: string, newPassword: string): Promise<void> => {
    await api.post('/auth/change-password', { old_password: oldPassword, new_password: newPassword })
  },
}

export const adminApi = {
  listRoles: async (): Promise<Role[]> => {
    const response = await api.get('/admin/roles')
    return response.data
  },

  createRole: async (name: string, description?: string): Promise<Role> => {
    const response = await api.post('/admin/roles', { name, description })
    return response.data
  },

  updateRole: async (roleId: string, name: string, description?: string): Promise<Role> => {
    const response = await api.put(`/admin/roles/${roleId}`, { name, description })
    return response.data
  },

  deleteRole: async (roleId: string): Promise<void> => {
    await api.delete(`/admin/roles/${roleId}`)
  },

  assignRolePermissions: async (roleId: string, permissionNames: string[]): Promise<Role> => {
    const response = await api.post(`/admin/roles/${roleId}/permissions`, { permission_names: permissionNames })
    return response.data
  },

  listUsers: async (): Promise<User[]> => {
    const response = await api.get('/admin/users')
    return response.data
  },

  assignUserRoles: async (userId: string, roleNames: string[]): Promise<User> => {
    const response = await api.put(`/admin/users/${userId}/roles`, { role_names: roleNames })
    return response.data
  },

  listPermissions: async (): Promise<{ name: string; resource: string; action: string; description?: string }[]> => {
    const response = await api.get('/admin/permissions')
    return response.data
  },
}
