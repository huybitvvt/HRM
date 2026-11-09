import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { mapUserToApp } from '../utils/helpers'
import {
  authenticateWithEcoBackend,
  consumeEcoSsoFromLocation,
  isEcoSsoDisabled,
  readStoredEcoUser,
  setEcoSsoDisabled,
  syncEcoUserToHrmProfile
} from '../utils/ecoAuthSync'

const AuthContext = createContext(null)
const LOCAL_SESSION_KEY = 'hrmspeego.accountSession'
const INVALID_LOGIN = 'Tên tài khoản hoặc mật khẩu không chính xác.'

const readLocalSession = () => {
  try {
    const raw = localStorage.getItem(LOCAL_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.id ? parsed : null
  } catch {
    return null
  }
}

const writeLocalSession = profile => {
  if (!profile?.id) {
    localStorage.removeItem(LOCAL_SESSION_KEY)
    return
  }
  const { password, ...safe } = profile
  localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(safe))
}

const loadProfile = async (authUser) => {
  if (!authUser?.id) return null
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('auth_user_id', authUser.id)
    .single()
  if (error) throw error
  return { ...mapUserToApp(data), id: data.id, authUserId: authUser.id, email: data.email || authUser.email || '' }
}

const profileFromAccount = row => {
  if (!row?.id) return null
  return {
    ...mapUserToApp(row),
    id: row.id,
    email: row.email || ''
  }
}

const refreshAccountProfile = async storedProfile => {
  if (!storedProfile?.id) return storedProfile
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', storedProfile.id)
    .maybeSingle()
  if (error) throw error
  const profile = profileFromAccount(data)
  if (!profile) return storedProfile
  if (storedProfile.ecoUserId) {
    return {
      ...profile,
      ho_va_ten: storedProfile.ho_va_ten || profile.ho_va_ten,
      role: storedProfile.role === 'admin' ? 'admin' : profile.role,
      vi_tri: storedProfile.vi_tri || profile.vi_tri,
      ecoUserId: storedProfile.ecoUserId
    }
  }
  return profile
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const syncSession = async (session) => {
      try {
        consumeEcoSsoFromLocation()
        const ecoUser = !isEcoSsoDisabled() ? readStoredEcoUser() : null

        if (session?.user) {
          const profile = await loadProfile(session.user)
          if (!active) return
          writeLocalSession(null)
          setUser(profile)
          return
        }

        const storedProfile = readLocalSession()
        const ecoUserId = ecoUser ? String(ecoUser.id || ecoUser.username || ecoUser.email || '').trim() : ''

        if (ecoUser && ecoUserId && (!storedProfile || storedProfile.ecoUserId !== ecoUserId)) {
          const syncedEcoProfile = await syncEcoUserToHrmProfile(ecoUser, supabase)
          if (syncedEcoProfile && active) {
            writeLocalSession(syncedEcoProfile)
            setUser(syncedEcoProfile)
            return
          }
        }

        if (storedProfile && active) {
          try {
            const currentProfile = await refreshAccountProfile(storedProfile)
            if (!active) return
            writeLocalSession(currentProfile)
            setUser(currentProfile)
          } catch (error) {
            console.warn('Không làm mới được hồ sơ tài khoản, dùng dữ liệu đã lưu:', error)
            if (active) setUser(storedProfile)
          }
        } else if (active) {
          setUser(storedProfile)
        }
      } catch (error) {
        console.error('Không tải được hồ sơ đăng nhập:', error)
        if (error?.code === 'PGRST116') {
          await supabase.auth.signOut().catch(() => {})
        }
        if (active) setUser(readLocalSession())
      } finally {
        if (active) setLoading(false)
      }
    }
    supabase.auth.getSession().then(({ data }) => syncSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => syncSession(session), 0)
    })
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  const loginWithSupabaseAuth = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    const profile = await loadProfile(data.user)
    writeLocalSession(null)
    setUser(profile)
    return profile
  }

  const loginWithEcoSession = async (explicitEcoUser = null) => {
    const ecoUser = explicitEcoUser || readStoredEcoUser()
    if (!ecoUser) {
      throw new Error('Chưa tìm thấy phiên đăng nhập Vận tải ECO trên trình duyệt này.')
    }
    setEcoSsoDisabled(false)
    await supabase.auth.signOut().catch(() => {})
    const profile = await syncEcoUserToHrmProfile(ecoUser, supabase)
    if (!profile) {
      throw new Error('Không thể đồng bộ hồ sơ tài khoản Vận tải ECO.')
    }
    writeLocalSession(profile)
    setUser(profile)
    return profile
  }

  const login = async (account, password) => {
    const cleanAccount = String(account || '').trim()
    const cleanPassword = String(password || '').trim()
    if (!cleanAccount || !cleanPassword) {
      throw new Error(INVALID_LOGIN)
    }

    setEcoSsoDisabled(false)

    const { data, error } = await supabase.rpc('login_with_account', {
      p_account: cleanAccount,
      p_password: cleanPassword
    })

    if (!error && data?.password_matched) {
      const email = String(data.email || '').trim()
      const hasLinkedAuthAccount = Boolean(data.auth_user_id)
      if (email && hasLinkedAuthAccount) {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email,
          password: cleanPassword
        })
        if (!authError) {
          const { data: authData } = await supabase.auth.getUser()
          try {
            const profile = await loadProfile(authData.user)
            writeLocalSession(null)
            setUser(profile)
            return profile
          } catch (profileError) {
            console.error('Không tải được hồ sơ Auth, dùng hồ sơ tài khoản:', profileError)
          }
        }
      }
      await supabase.auth.signOut().catch(() => {})
      const profile = profileFromAccount(data)
      if (!profile) throw new Error(INVALID_LOGIN)
      writeLocalSession(profile)
      setUser(profile)
      return profile
    }

    // Thử xác thực đồng bộ qua tài khoản hệ thống Vận tải ECO (/api/v1/auth/login)
    try {
      const ecoUser = await authenticateWithEcoBackend(cleanAccount, cleanPassword)
      if (ecoUser) {
        return await loginWithEcoSession(ecoUser)
      }
    } catch (ecoErr) {
      console.warn('Không xác thực được qua API ECO:', ecoErr)
    }

    if (error) {
      if (cleanAccount.includes('@')) return loginWithSupabaseAuth(cleanAccount, cleanPassword)
      throw new Error(INVALID_LOGIN)
    }

    const email = String(data?.email || (cleanAccount.includes('@') ? cleanAccount : '')).trim()
    if (!email) throw new Error(INVALID_LOGIN)
    try {
      return await loginWithSupabaseAuth(email, cleanPassword)
    } catch {
      throw new Error(INVALID_LOGIN)
    }
  }

  const logout = async () => {
    setEcoSsoDisabled(true)
    writeLocalSession(null)
    await supabase.auth.signOut()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, loginWithEcoSession, logout, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
