
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { loginRequest } from '../services/sismicoApi'

const AuthContext = createContext(null)
const STORAGE_KEY = 'tmone_auth'
const EMBED_NOCONE = import.meta.env.VITE_EMBED_NOCONE === 'true'

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => {
    if (EMBED_NOCONE) {
      const token = localStorage.getItem('token')
      return token ? { token, user: null } : null
    }
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') } catch { return null }
  })

  useEffect(() => {
    if (EMBED_NOCONE) return
    if (auth) localStorage.setItem(STORAGE_KEY, JSON.stringify(auth))
    else localStorage.removeItem(STORAGE_KEY)
  }, [auth])

  useEffect(() => {
    if (!EMBED_NOCONE || !auth?.token) return undefined
    let live = true
    fetch(`${import.meta.env.VITE_VISUAL_API_ROOT}/auth/me`, { headers: { Authorization: `Bearer ${auth.token}` } })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Sesión no válida')))
      .then(user => { if (live) setAuth(current => ({ ...current, user })) })
      .catch(() => { if (live) setAuth(null) })
    return () => { live = false }
  }, [auth?.token])

  const value = useMemo(() => ({
    auth,
    user: auth?.user || null,
    isAuthenticated: Boolean(auth?.token),
    async login(username, password) {
      const data = await loginRequest({ username, password })
      if (!data?.ok) throw new Error(data?.message || 'Credenciales inválidas')
      setAuth({ token: data.token, user: data.user })
      return data
    },
    logout() { if (EMBED_NOCONE) { window.top.location.href = '/login'; return } setAuth(null) },
  }), [auth])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
