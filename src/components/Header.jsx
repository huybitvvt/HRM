import { getEcoAppUrl } from '../utils/ecoLink'

function Header({ menuOpen = false, onMenuToggle }) {
  return (
    <header className="header">
      <button
        type="button"
        className={`header-menu-btn${menuOpen ? ' is-open' : ''}`}
        onClick={onMenuToggle}
        aria-label={menuOpen ? 'Đóng menu' : 'Mở menu'}
        aria-expanded={menuOpen}
      >
        <i className={`fas ${menuOpen ? 'fa-times' : 'fa-bars'}`}></i>
      </button>
      <div className="header-brand">
        <img src="/logo-express-exacting.png" alt="ECO Transport" />
        <span>ECO HR</span>
      </div>
      <a className="header-eco-link" href={getEcoAppUrl()}>
        <i className="fas fa-truck-fast" aria-hidden="true"></i>
        <span>Về ECO</span>
      </a>
    </header>
  )
}

export default Header
