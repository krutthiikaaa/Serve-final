import { Link, Outlet } from 'react-router-dom';
import type { MeStaff } from '@serve/contracts';
import {
  ConnectionBanner,
  IconBag,
  IconBell,
  IconGrid,
  IconReceipt,
  IconUser,
  IconUtensils,
  Select,
  Shell,
  Tag,
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
  const { canteenId, assignment, assignments, selectCanteen, hasCapability } = useStaffCanteen();
  const canteen = assignment?.canteen ?? me.canteen!;

  useServerEvent('staff.canteen_assigned', () => void refreshMe());
  useServerEvent('staff.deactivated', () => void refreshMe());
  useServerEvent('canteen.status_changed', () => void refreshMe());

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
        assignments.length > 1 ? (
          <>
            <small>Working at</small>
            <Select
              aria-label="Selected canteen"
              value={canteenId}
              onChange={(event) => selectCanteen(event.target.value)}
            >
              {assignments.map((row) => (
                <option key={row.canteenId} value={row.canteenId}>
                  {row.canteen.name}
                </option>
              ))}
            </Select>
          </>
        ) : (
          <>
            <small>Assigned canteen</small>
            {canteen.name}
          </>
        )
      }
      nav={nav}
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
