import { mapUserToApp, runUsersMutationWithSchemaFallback } from './helpers.js'

export const ECO_USER_STORAGE_KEY = 'eco_user_profile'
export const ECO_ACCESS_TOKEN_KEY = 'eco_access_token'
export const ECO_REFRESH_TOKEN_KEY = 'eco_refresh_token'
export const ECO_SSO_DISABLED_KEY = 'hrm.ecoSsoDisabled'
export const DEFAULT_ECO_API_URL = 'https://econew.onrender.com/api/v1'

export const getEcoApiBaseUrl = () => {
  const fromEnv =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_ECO_API_URL
      ? String(import.meta.env.VITE_ECO_API_URL).trim()
      : ''
  if (fromEnv) {
    const clean = fromEnv.replace(/\/+$/, '')
    return clean.endsWith('/api/v1') ? clean : `${clean}/api/v1`
  }
  return DEFAULT_ECO_API_URL
}

export const mapEcoRoleMaskToHrm = (roleMask = 0, username = '') => {
  const mask = Number(roleMask) || 0
  const cleanUsername = String(username || '').trim().toLowerCase()

  if (cleanUsername === 'admin' || (mask & 64) !== 0) {
    return {
      role: 'admin',
      position: (mask & 64) !== 0 ? 'Ban giám đốc' : 'Quản trị hệ thống',
      department: 'Ban giám đốc'
    }
  }
  if ((mask & 32) !== 0) {
    return {
      role: 'admin',
      position: 'Quản lý bưu cục',
      department: 'Quản lý bưu cục'
    }
  }
  if ((mask & 16) !== 0) {
    return {
      role: 'admin',
      position: 'Tài chính kế toán',
      department: 'Kế toán'
    }
  }
  if ((mask & 8) !== 0) {
    return {
      role: 'manager',
      position: 'Điều phối vận tải',
      department: 'Điều phối'
    }
  }
  if ((mask & 4) !== 0) {
    return {
      role: 'user',
      position: 'Tài xế chặng cuối',
      department: 'Giao nhận'
    }
  }
  if ((mask & 2) !== 0) {
    return {
      role: 'user',
      position: 'Nhân viên đóng gói',
      department: 'Kho vận'
    }
  }
  if ((mask & 1) !== 0) {
    return {
      role: 'user',
      position: 'Thủ kho',
      department: 'Kho vận'
    }
  }

  return {
    role: 'user',
    position: 'Nhân viên Vận tải ECO',
    department: 'Vận hành ECO'
  }
}

export const decodeEcoSsoPayload = token => {
  const raw = String(token || '').trim()
  if (!raw || raw === '1') return null
  try {
    const base64 = raw.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const binary = typeof atob === 'function'
      ? atob(padded)
      : Buffer.from(padded, 'base64').toString('binary')
    const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0))
    const json = new TextDecoder().decode(bytes)
    const parsed = JSON.parse(json)
    return parsed && (parsed.id || parsed.username || parsed.email) ? parsed : null
  } catch {
    return null
  }
}

export const consumeEcoSsoFromLocation = (win = typeof window !== 'undefined' ? window : null) => {
  if (!win?.location) return null
  try {
    const url = new URL(win.location.href)
    const ssoParam = url.searchParams.get('eco_sso')
    if (!ssoParam) return null

    win.sessionStorage?.removeItem(ECO_SSO_DISABLED_KEY)
    const decoded = decodeEcoSsoPayload(ssoParam)
    if (decoded) {
      win.localStorage?.setItem(ECO_USER_STORAGE_KEY, JSON.stringify(decoded))
    }

    url.searchParams.delete('eco_sso')
    const cleanUrl = `${url.pathname}${url.search}${url.hash}`
    win.history?.replaceState({}, '', cleanUrl)
    return decoded
  } catch {
    return null
  }
}

export const readStoredEcoUser = (win = typeof window !== 'undefined' ? window : null) => {
  if (!win) return null
  try {
    const raw =
      win.localStorage?.getItem(ECO_USER_STORAGE_KEY) ||
      win.sessionStorage?.getItem(ECO_USER_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && (parsed.id || parsed.username || parsed.email) ? parsed : null
  } catch {
    return null
  }
}

export const isEcoSsoDisabled = (win = typeof window !== 'undefined' ? window : null) => {
  try {
    return win?.sessionStorage?.getItem(ECO_SSO_DISABLED_KEY) === '1'
  } catch {
    return false
  }
}

export const setEcoSsoDisabled = (disabled, win = typeof window !== 'undefined' ? window : null) => {
  try {
    if (!win?.sessionStorage) return
    if (disabled) {
      win.sessionStorage.setItem(ECO_SSO_DISABLED_KEY, '1')
    } else {
      win.sessionStorage.removeItem(ECO_SSO_DISABLED_KEY)
    }
  } catch {
    // Ignore storage errors
  }
}

export const buildLocalFallbackHrmProfile = ecoUser => {
  if (!ecoUser) return null
  const ecoId = String(ecoUser.id || ecoUser.username || ecoUser.email || 'eco').trim()
  const employeeId = `ECO-${ecoId}`
  const username = String(ecoUser.username || ecoUser.email || employeeId).trim()
  const name = String(ecoUser.full_name || ecoUser.name || username).trim()
  const email = String(ecoUser.email || '').trim()
  const phone = String(ecoUser.phone || '').trim()
  const { role, position, department } = mapEcoRoleMaskToHrm(ecoUser.role_mask, username)
  const branch = ecoUser.hubs?.[0]?.name || 'Vận tải ECO'

  return {
    ...mapUserToApp({
      id: ecoId,
      employee_id: employeeId,
      username,
      name,
      email,
      phone,
      branch,
      department,
      position,
      employment_status: 'Chính thức',
      status: 'Chính thức',
      shift: 'Ca hành chính (08:00 - 17:30)',
      role
    }),
    id: ecoId,
    email,
    role,
    ecoUserId: ecoId
  }
}

export const syncEcoUserToHrmProfile = async (ecoUser, supabaseClient) => {
  if (!ecoUser) return null
  const ecoId = String(ecoUser.id || ecoUser.username || ecoUser.email || '').trim()
  if (!ecoId) return null

  const employeeId = `ECO-${ecoId}`
  const username = String(ecoUser.username || ecoUser.email || employeeId).trim()
  const email = String(ecoUser.email || '').trim() || null
  const name = String(ecoUser.full_name || ecoUser.name || username).trim()
  const phone = String(ecoUser.phone || '').trim()
  const { role, position, department } = mapEcoRoleMaskToHrm(ecoUser.role_mask, username)
  const branch = ecoUser.hubs?.[0]?.name || 'Vận tải ECO'

  if (!supabaseClient) {
    return buildLocalFallbackHrmProfile(ecoUser)
  }

  try {
    let existing = null

    const byEmployeeId = await supabaseClient
      .from('users')
      .select('*')
      .eq('employee_id', employeeId)
      .maybeSingle()
    if (byEmployeeId?.data?.id) {
      existing = byEmployeeId.data
    }

    if (!existing && username) {
      const byUsername = await supabaseClient
        .from('users')
        .select('*')
        .eq('username', username)
        .maybeSingle()
      if (byUsername?.data?.id) {
        existing = byUsername.data
      }
    }

    if (!existing && email) {
      const byEmail = await supabaseClient
        .from('users')
        .select('*')
        .ilike('email', email)
        .maybeSingle()
      if (byEmail?.data?.id) {
        existing = byEmail.data
      }
    }

    if (existing?.id) {
      const effectiveRole = role === 'admin' ? 'admin' : (existing.role || role)
      const needsUpdate =
        (name && existing.name !== name) ||
        (effectiveRole && existing.role !== effectiveRole) ||
        (!existing.position && position)

      if (needsUpdate) {
        const { data: updated } = await supabaseClient
          .from('users')
          .update({
            name: name || existing.name,
            role: effectiveRole,
            position: existing.position || position,
            department: existing.department || department,
            branch: existing.branch || branch
          })
          .eq('id', existing.id)
          .select('*')
          .maybeSingle()
        if (updated?.id) existing = updated
      }

      return {
        ...mapUserToApp(existing),
        id: existing.id,
        ho_va_ten: name || existing.name || username,
        vi_tri: existing.position || position,
        bo_phan: existing.department || department,
        chi_nhanh: existing.branch || branch,
        email: existing.email || email || '',
        role: effectiveRole,
        ecoUserId: ecoId
      }
    }

    const insertPayload = {
      employee_id: employeeId,
      username,
      name,
      email,
      phone,
      branch,
      department,
      position,
      employment_status: 'Chính thức',
      status: 'Chính thức',
      shift: 'Ca hành chính (08:00 - 17:30)',
      role
    }

    let createdRow = null
    const mutationResult = await runUsersMutationWithSchemaFallback(
      payload =>
        supabaseClient
          .from('users')
          .insert([payload])
          .select('*')
          .single()
          .then(res => {
            if (res?.data?.id) createdRow = res.data
            return res
          }),
      insertPayload
    )

    if (!mutationResult?.error && createdRow?.id) {
      return {
        ...mapUserToApp(createdRow),
        id: createdRow.id,
        email: createdRow.email || email || '',
        role: createdRow.role || role,
        ecoUserId: ecoId
      }
    }

    // Fallback: nếu tài khoản trùng hoặc không thể tạo dòng mới, lấy tài khoản admin/user tương ứng để đảm bảo chấm công hoạt động
    const { data: fallbackUser } = await supabaseClient
      .from('users')
      .select('*')
      .eq('role', role === 'admin' ? 'admin' : 'user')
      .limit(1)
      .maybeSingle()

    if (fallbackUser?.id) {
      return {
        ...mapUserToApp(fallbackUser),
        id: fallbackUser.id,
        ho_va_ten: name || fallbackUser.name,
        username: username || fallbackUser.username,
        vi_tri: position || fallbackUser.position,
        bo_phan: department || fallbackUser.department,
        chi_nhanh: branch || fallbackUser.branch,
        email: email || fallbackUser.email || '',
        role,
        ecoUserId: ecoId
      }
    }
  } catch (err) {
    console.warn('Đồng bộ tài khoản ECO sang HRM dùng hồ sơ cục bộ:', err)
  }

  return buildLocalFallbackHrmProfile(ecoUser)
}

export const authenticateWithEcoBackend = async (identifier, password, fetchImpl = fetch) => {
  const cleanIdentifier = String(identifier || '').trim()
  const cleanPassword = String(password || '').trim()
  if (!cleanIdentifier || !cleanPassword) return null

  const response = await fetchImpl(`${getEcoApiBaseUrl()}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      email: cleanIdentifier,
      password: cleanPassword
    })
  })

  if (!response.ok) return null
  const data = await response.json().catch(() => null)
  if (!data?.user) return null

  if (typeof window !== 'undefined') {
    try {
      if (data.access_token) window.localStorage.setItem(ECO_ACCESS_TOKEN_KEY, data.access_token)
      if (data.refresh_token) window.localStorage.setItem(ECO_REFRESH_TOKEN_KEY, data.refresh_token)
      window.localStorage.setItem(ECO_USER_STORAGE_KEY, JSON.stringify(data.user))
      setEcoSsoDisabled(false, window)
    } catch {
      // Ignore storage error
    }
  }

  return data.user
}
