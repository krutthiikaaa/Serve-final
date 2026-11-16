import { Link, Outlet } from 'react-router-dom';
import type { MeStaff } from '@serve/contracts';
import {
  AvailabilityTag,
  CanteenTypeBadge,
  ConnectionBanner,
  IconBag,
  IconBell,
  IconGrid,
  IconReceipt,
  IconUser,
  IconUtensils,
  Shell,
  useAuth,
  useNotifications,
  useRealtime,
  useServerEvent,
} from '@serve/web-shared';
import { useStaffCanteen } from '../staffCanteen';

/** Staff application shell: sidebar, assigned canteen, live status and notifications. */
export function StaffLayout({ me }: { me: MeStaff }) {
  const { signOut, refreshMe } = useAuth();
  const { state } = useRealtime();
  const { unreadCount } = useNotifications();
  const { hasCapability } = useStaffCanteen();
  const canteen = me.canteen!;

  useServerEvent('staff.canteen_assigned', () => void refreshMe());
  useServerEvent('staff.deactivated', () => void refreshMe());
  useServerEvent('staff.unassigned', () => void refreshMe());
  useServerEvent('canteen.status_changed', () => void refreshMe());
  // The other canteen of the area switching on/off changes this one's state too.
  useServerEvent('service_area.updated', () => void refreshMe());

  const nav = [
    { to: '/', label: 'Dashboard', icon: <IconGrid /> },
    ...(hasCapability('KITCHEN')
      ? [{ to: '/orders', label: 'Orders', icon: <IconReceipt /> }]
      : []),
    ...(hasCapability('MENU') ? [{ to: '/menu', label: 'Menu', icon: <IconUtensils /> }] : []),
    ...(hasCapability('CASHIER') ? [{ to: '/cashier', label: 'Cashier', icon: <IconBag /> }] : []),
    { to: '/notifications', label: 'Notifications', icon: <IconBell />, count: unreadCount },
    { to: '/account', label: 'Account', icon: <IconUser /> },
  ];

  return (
    <Shell
      product="Staff dashboard"
      context={
        <>
          <small>Your canteen</small>
          <span className="context-name">{canteen.name}</span>
          <CanteenTypeBadge type={canteen.type} />
        </>
      }
      nav={nav}
      onSignOut={() => void signOut()}
      banner={<ConnectionBanner state={state} />}
      topbar={
        <>
          <div className="topbar-title">
            <strong>{canteen.name}</strong>
            <CanteenTypeBadge type={canteen.type} />
            <AvailabilityTag state={canteen.availability.state} />
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
