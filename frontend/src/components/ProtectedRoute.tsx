import { Navigate } from 'react-router-dom'
import { Spin } from 'antd'
import { useAuth } from '@/hooks/useAuth'

interface ProtectedRouteProps {
  children: React.ReactNode
  requiredPermission?: string
  requiredRole?: string
}

export default function ProtectedRoute({ children, requiredPermission, requiredRole }: ProtectedRouteProps) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (requiredPermission && !user.permissions.includes(requiredPermission)) {
    return <Navigate to="/documents" replace />
  }

  if (requiredRole && !user.roles.includes(requiredRole)) {
    return <Navigate to="/documents" replace />
  }

  return <>{children}</>
}