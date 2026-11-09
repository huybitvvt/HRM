export const DEFAULT_ECO_APP_URL = 'https://econew-six.vercel.app'

export const getEcoAppUrl = () => {
  const configured =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_ECO_APP_URL
      ? String(import.meta.env.VITE_ECO_APP_URL).trim()
      : ''
  return (configured || DEFAULT_ECO_APP_URL).replace(/\/+$/, '')
}

export const getEcoPathUrl = (path = '/') => {
  const base = getEcoAppUrl()
  const cleanPath = String(path || '/').startsWith('/') ? String(path || '/') : `/${path}`
  return `${base}${cleanPath === '/' ? '' : cleanPath}`
}

