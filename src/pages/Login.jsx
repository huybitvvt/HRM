import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { readStoredEcoUser } from '../utils/ecoAuthSync'
import { getEcoAppUrl } from '../utils/ecoLink'
import { isAccountingUser, isCoreStaffUser } from '../utils/staffAccess'
import './Login.css'

function Login() {
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const { user, login, loginWithEcoSession } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from?.pathname || '/'
  const storedEcoUser = readStoredEcoUser()

  const navigateAfterLogin = profile => {
    if (isAccountingUser(profile) && !isCoreStaffUser(profile)) {
      const target = ['/bang-cong-preview', '/holiday-settings', '/cham-cong-online'].includes(from)
        ? from
        : '/bang-cong-preview'
      navigate(target, { replace: true })
      return true
    }
    if (profile?.role === 'user') {
      const target = ['/bang-cong-preview', '/cham-cong-online', '/lich-su-cham-cong'].includes(from)
        ? from
        : '/cham-cong-online'
      navigate(target, { replace: true })
      return true
    }
    if (isCoreStaffUser(profile)) {
      const target = ['/', '/login'].includes(from) ? '/employees' : from
      navigate(target, { replace: true })
      return true
    }
    return false
  }

  useEffect(() => {
    if (user) {
      navigateAfterLogin(user)
    }
  }, [user])

  const handleEcoQuickLogin = async () => {
    setError('')
    setLoading(true)
    try {
      const profile = await loginWithEcoSession()
      if (!navigateAfterLogin(profile)) {
        setError('Tài khoản chưa được cấp quyền sử dụng hệ thống.')
      }
    } catch (err) {
      setError(err?.message || 'Không thể đồng bộ phiên đăng nhập Vận tải ECO.')
    } finally {
      setLoading(false)
    }
  }

  const handleLogin = async event => {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      const profile = await login(account.trim(), password.trim())
      if (!navigateAfterLogin(profile)) {
        setError('Tài khoản chưa được cấp quyền sử dụng hệ thống.')
      }
    } catch (loginError) {
      console.error('Login error:', loginError)
      const msg = loginError?.message || ''
      if (msg.includes('Invalid login credentials') || msg.includes('Tên tài khoản hoặc mật khẩu')) {
        setError('Tên tài khoản hoặc mật khẩu không chính xác. Bạn có thể đăng nhập bằng tài khoản Vận tải ECO hoặc mã nhân viên HRM.')
      } else if (msg) {
        setError(msg)
      } else {
        setError('Tên tài khoản hoặc mật khẩu không chính xác.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="system-login">
      <section className="system-login__form-panel">
        <div className="system-login__form-wrap">
          <div className="system-login__intro">
            <img src="/logo-express-exacting.png" alt="ECO Transport" />
            <h1>Đăng nhập hệ thống</h1>
            <p>Hệ thống Nhân sự &amp; Chấm công — Đồng bộ tài khoản Vận tải ECO</p>
          </div>

          {error && <div className="system-login__error"><i className="fas fa-exclamation-circle"></i><span>{error}</span></div>}

          {storedEcoUser && (
            <button
              type="button"
              onClick={handleEcoQuickLogin}
              disabled={loading}
              style={{
                width: '100%',
                marginBottom: '16px',
                padding: '12px 16px',
                borderRadius: '10px',
                border: '1px solid #bfdbfe',
                background: '#eff6ff',
                color: '#1d4ed8',
                fontWeight: 700,
                fontSize: '0.92rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              <i className="fas fa-user-check"></i>
              Tiếp tục với tài khoản ECO: {storedEcoUser.full_name || storedEcoUser.username || storedEcoUser.email}
            </button>
          )}

          <form onSubmit={handleLogin}>
            <label className="system-login__field">
              <span>Tài khoản Vận tải ECO / Mã nhân viên</span>
              <div><i className="fas fa-user"></i><input type="text" value={account} onChange={event => setAccount(event.target.value)} placeholder="Email / Tên đăng nhập ECO hoặc Mã NV" autoComplete="username" required /></div>
            </label>
            <label className="system-login__field">
              <span>Mật khẩu</span>
              <div style={{ position: 'relative' }}>
                <i className="fas fa-lock"></i>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  style={{ paddingRight: '40px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#64748b',
                    fontSize: '0.95rem'
                  }}
                  title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                >
                  <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                </button>
              </div>
            </label>
            <button className="system-login__submit" type="submit" disabled={loading}>
              {loading ? <><i className="fas fa-spinner fa-spin"></i> Đang kết nối...</> : <>Đăng nhập <i className="fas fa-arrow-right"></i></>}
            </button>
          </form>

          <p className="system-login__employee-link">
            Nhân viên có thể đăng nhập tại đây hoặc <Link to="/employee-login">mở trang nhân viên</Link> ·{' '}
            <a href={getEcoAppUrl()}>Về hệ thống Vận tải ECO</a>
          </p>
        </div>
        <footer>© 2026 ECO Transport HR &amp; Attendance System</footer>
      </section>

      <aside className="system-login__branding" aria-label="ECO Transport">
        <div className="system-login__branding-content">
          <div className="system-login__brand-logo"><img src="/logo-express-exacting.png" alt="ECO Transport" /></div>
          <h2>ECO TRANSPORT</h2>
          <p className="system-login__slogan">EXPRESS &amp; EXACTING</p>
          <div className="system-login__accent"></div>
          <p className="system-login__description">Hệ thống quản lý nhân sự, chấm công trực tuyến và chấm công Wi-Fi văn phòng đồng bộ cùng Vận tải ECO.</p>
        </div>
      </aside>
    </main>
  )
}

export default Login
