import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Logo } from './ui/components';
import { IconLogout } from './ui/icons';

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
  return (
    <div className="shell">
      <aside className="sidebar" aria-label={`${product} navigation`}>
        <div className="sidebar-brand">
          <Logo />
          <div className="small muted product-name">{product}</div>
        </div>
        {context ? <div className="sidebar-context">{context}</div> : null}
        <nav className="nav">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} title={item.label}>
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
        <header className="topbar">{topbar}</header>
        <main className="page">{children}</main>
      </div>
    </div>
  );
}
