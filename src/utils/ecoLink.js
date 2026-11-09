export const DEFAULT_ECO_APP_URL = 'https://econew-six.vercel.app'

export const getEcoAppUrl = () => {
  const configured =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_ECO_APP_URL
      ? String(import.meta.env.VITE_ECO_APP_URL).trim()
      : ''
  if (configured) {
    return configured.replace(/\/+$/, '')
  }
  if (typeof window !== 'undefined' && /^\/hrm(\/|$)/i.test(window.location.pathname)) {
    return `${window.location.origin}/hr`
  }
  return `${DEFAULT_ECO_APP_URL}/hr`
}

export const getEcoPathUrl = (path = '/hr') => {
  const base =
    typeof window !== 'undefined' && /^\/hrm(\/|$)/i.test(window.location.pathname)
      ? window.location.origin
      : DEFAULT_ECO_APP_URL
  const cleanPath = String(path || '/').startsWith('/') ? String(path || '/') : `/${path}`
  return `${base}${cleanPath === '/' ? '' : cleanPath}`
}
