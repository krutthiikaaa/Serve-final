import { Link, Outlet } from 'react-router-dom';
import type { MeStaff } from '@serve/contracts';
import {
  ConnectionBanner,
  IconBell,
  IconGrid,
  IconReceipt,
  IconUser,
  IconUtensils,
  Shell,
  Tag,
  useAuth,
  useNotifications,
  useRealtime,
  useServerEvent,
} from '@serve/web-shared';

/** Staff application shell: sidebar, assigned canteen, live status and notifications. */
export function StaffLayout({ me }: { me: MeStaff }) {
  const { signOut, refreshMe } = useAuth();
  const { state } = useRealtime();
  const { unreadCount } = useNotifications();
  const canteen = me.canteen!;

  // Assignment changes are decided by an admin; the gate re-routes from /auth/me.
  useServerEvent('staff.canteen_assigned', () => void refreshMe());
  useServerEvent('staff.deactivated', () => void refreshMe());
  useServerEvent('canteen.status_changed', () => void refreshMe());

  return (
    <Shell
      product="Staff dashboard"
      context={
        <>
          <small>Assigned canteen</small>
          {canteen.name}
        </>
      }
      nav={[
        { to: '/', label: 'Dashboard', icon: <IconGrid /> },
        { to: '/orders', label: 'Orders', icon: <IconReceipt /> },
        { to: '/menu', label: 'Menu', icon: <IconUtensils /> },
        { to: '/notifications', label: 'Notifications', icon: <IconBell />, count: unreadCount },
        { to: '/account', label: 'Account', icon: <IconUser /> },
      ]}
      onSignOut={() => void signOut()}
      banner={<ConnectionBanner state={state} />}
      topbar={
        <>
          <div className="topbar-title">
            <strong>{canteen.name}</strong>
            <CanteenStatusTag canteen={canteen} />
          </div>
          <div className="topbar-actions">
            <Link
              to="/notifications"
              className="icon-button"
              aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
            >
              <IconBell />
              {unreadCount ? (
                <span className="badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
              ) : null}
            </Link>
            <span className="topbar-user">
              <span className="avatar" aria-hidden>
                {me.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="topbar-user-name">{me.name}</span>
            </span>
          </div>
        </>
      }
    >
      <Outlet />
    </Shell>
  );
}

export function CanteenStatusTag({
  canteen,
}: {
  canteen: { isActive: boolean; isAcceptingOrders: boolean };
}) {
  if (!canteen.isActive) return <Tag tone="danger">Inactive</Tag>;
  return canteen.isAcceptingOrders ? (
    <Tag tone="success">Accepting orders</Tag>
  ) : (
    <Tag tone="warning">Paused</Tag>
  );
}
