import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { readStoredEcoUser } from '../utils/ecoAuthSync'
import { getEcoAppUrl } from '../utils/ecoLink'
import { getDefaultLandingPath } from '../utils/staffAccess'
import './EmployeeLogin.css'

function EmployeeLogin() {
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { user, login, loginWithEcoSession, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const storedEcoUser = readStoredEcoUser()

  useEffect(() => {
    if (user) {
      const requestedPath = location.state?.from?.pathname
      const destination = getDefaultLandingPath(user)
      navigate(requestedPath || destination || '/cham-cong-online', { replace: true })
    }
  }, [user, location.state, navigate])

  const handleEcoQuickLogin = async () => {
    setLoading(true)
    setError('')
    try {
      const profile = await loginWithEcoSession()
      const requestedPath = location.state?.from?.pathname
      const destination = getDefaultLandingPath(profile)
      navigate(requestedPath || destination || '/cham-cong-online', { replace: true })
    } catch (err) {
      setError(err?.message || 'Không thể đồng bộ tài khoản Vận tải ECO')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const profile = await login(account.trim(), password)
      const destination = getDefaultLandingPath(profile)
      if (!profile || destination === '/login') {
        await logout()
        setError('Tài khoản chưa được cấp quyền sử dụng hệ thống.')
        return
      }
      const requestedPath = location.state?.from?.pathname
      navigate(requestedPath === '/bang-cong-preview' ? requestedPath : destination, { replace: true })
    } catch (loginError) {
      console.error('Employee login error:', loginError)
      setError('Tên tài khoản hoặc mật khẩu không chính xác')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="employee-login">
      <section className="employee-login__card">
        <img src="/logo-express-exacting.png" alt="ECO Transport" />
        <h1>Đăng nhập nhân viên</h1>
        <p>Chấm công Online / Wi-Fi &amp; Xem Bảng công Vận tải ECO</p>
        {error && <div className="employee-login__error">{error}</div>}
        {storedEcoUser && (
          <button
            type="button"
            onClick={handleEcoQuickLogin}
            disabled={loading}
            style={{
              width: '100%',
              marginBottom: '12px',
              padding: '10px 14px',
              borderRadius: '10px',
              border: '1px solid #bfdbfe',
              background: '#eff6ff',
              color: '#1d4ed8',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            Tiếp tục với tài khoản ECO: {storedEcoUser.full_name || storedEcoUser.username}
          </button>
        )}
        <form onSubmit={handleSubmit}>
          <label><span>Tài khoản ECO / Mã nhân viên</span><input type="text" value={account} onChange={event => setAccount(event.target.value)} placeholder="Email / Tên đăng nhập ECO hoặc Mã NV" autoComplete="username" required /></label>
          <label><span>Mật khẩu</span><input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Nhập mật khẩu" autoComplete="current-password" required /></label>
          <button type="submit" disabled={loading}>{loading ? 'Đang đăng nhập...' : 'Đăng nhập'}</button>
        </form>
        <Link to="/login">Đăng nhập quản trị</Link>
        <a href={getEcoAppUrl()} style={{ marginTop: 10, fontSize: '0.88rem', color: '#64748b' }}>← Về hệ thống Vận tải ECO</a>
      </section>
    </main>
  )
}

export default EmployeeLogin
