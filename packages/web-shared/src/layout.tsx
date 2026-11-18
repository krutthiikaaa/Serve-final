import { useEffect, useId, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Logo } from './ui/components';
import { IconLogout, IconMenu, IconX } from './ui/icons';

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  count?: number | undefined;
}

/** Sidebar application shell shared by the staff dashboard and admin portal. */
export function Shell({
  product,
  context,
  nav,
  onSignOut,
  topbar,
  banner,
  children,
}: {
  product: string;
  context?: ReactNode;
  nav: NavItem[];
  onSignOut: () => void;
  topbar: ReactNode;
  banner?: ReactNode;
  children: ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const sidebarId = useId();

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNavOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [navOpen]);

  const closeNav = () => setNavOpen(false);

  return (
    <div className={`shell${navOpen ? ' shell-nav-open' : ''}`}>
      <div
        className="shell-backdrop"
        hidden={!navOpen}
        onClick={closeNav}
        aria-hidden="true"
      />
      <aside id={sidebarId} className="sidebar" aria-label={`${product} navigation`}>
        <div className="sidebar-brand">
          <Logo size={40} />
          <span className="product-badge">{product}</span>
        </div>
        {context ? <div className="sidebar-context">{context}</div> : null}
        <nav className="nav">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              title={item.label}
              onClick={closeNav}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.count ? <em className="nav-count">{item.count}</em> : null}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer nav">
          <button type="button" onClick={onSignOut} title="Log out">
            <IconLogout />
            <span>Log out</span>
          </button>
        </div>
      </aside>
      <div className="main">
        {banner}
        <header className="topbar">
          <button
            type="button"
            className="shell-nav-toggle icon-button"
            aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={navOpen}
            aria-controls={sidebarId}
            onClick={() => setNavOpen((open) => !open)}
          >
            {navOpen ? <IconX /> : <IconMenu />}
          </button>
          <div className="topbar-body">{topbar}</div>
        </header>
        <main className="page">{children}</main>
      </div>
    </div>
  );
}
