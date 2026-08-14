import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError } from './api'

export type MenuKey = 'dashboard' | 'myTasks' | 'workspace' | 'projects' | 'docs' | 'docsHistory'

export interface Me {
  id: string
  name: string
  email: string
  role: 'owner' | 'member' | 'vendor' | 'guest'
  avatarUrl: string | null
  firstName: string | null
  lastName: string | null
  nickname: string | null
  // Pronista §System Requirements Update — เมนู sidebar ที่มองเห็นได้ ผูกกับหมวดผู้ใช้งาน (owner = ทุกเมนู true เสมอ)
  menuVisibility: Record<MenuKey, boolean>
  // Pronista §Import Data — ซ่อนปุ่ม Import Data เฉพาะ production ผ่าน env var (ยังเปิดบน staging/local)
  importDataEnabled: boolean
}

interface AuthState {
  user: Me | null
  loading: boolean
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setUser(await api.get<Me>('/api/me'))
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setUser(null)
      else throw e
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout')
    setUser(null)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <AuthContext.Provider value={{ user, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth ต้องอยู่ใต้ AuthProvider')
  return ctx
}
