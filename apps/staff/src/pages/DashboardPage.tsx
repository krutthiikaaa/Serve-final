import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ORDER_EVENT_NAMES } from '@serve/contracts';
import {
  Button,
  EmptyState,
  ErrorState,
  IconBag,
  IconCheck,
  IconFlame,
  IconPause,
  IconPlay,
  IconReceipt,
  SkeletonRows,
  StatusPill,
  formatRupees,
  formatTime,
  useAuth,
  useRealtime,
  useResource,
  useServerEvent,
  useServerEvents,
  useToast,
  errorMessage,
} from '@serve/web-shared';
import { useStaffApi } from '../useStaffApi';
import { CanteenStatusTag } from '../components/StaffLayout';

/** Live overview of the assigned canteen. Every number comes from `/api/staff/dashboard`. */
export function DashboardPage() {
  const api = useStaffApi();
  const { refreshMe } = useAuth();
  const toast = useToast();
  const { connectionEpoch } = useRealtime();
  const dashboard = useResource(() => api.dashboard(), [api, connectionEpoch]);
  const recent = useResource(() => api.orders('active', { limit: 8 }), [api, connectionEpoch]);
  const [toggling, setToggling] = useState(false);

  // Server events only trigger a refetch; the numbers are never computed client-side.
  useServerEvents(ORDER_EVENT_NAMES, () => {
    void dashboard.reload();
    void recent.reload();
  });
  useServerEvent('canteen.status_changed', () => void dashboard.reload());

  const toggle = async (accepting: boolean) => {
    setToggling(true);
    try {
      await api.setAcceptingOrders(accepting);
      await Promise.all([dashboard.reload(), refreshMe()]);
      toast(accepting ? 'Now accepting orders' : 'Order-taking paused');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setToggling(false);
    }
  };

  if (dashboard.error && !dashboard.data)
    return <ErrorState error={dashboard.error} onRetry={() => void dashboard.reload()} />;
  const data = dashboard.data;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Tonight at {data ? data.canteen.name : 'your canteen'}</p>
        </div>
        {data ? (
          <div className="header-actions">
            <CanteenStatusTag canteen={data.canteen} />
            {data.canteen.isActive ? (
              data.canteen.isAcceptingOrders ? (
                <Button
                  variant="secondary"
                  icon={<IconPause width={16} height={16} />}
                  loading={toggling}
                  onClick={() => void toggle(false)}
                >
                  Pause orders
                </Button>
              ) : (
                <Button
                  icon={<IconPlay width={16} height={16} />}
                  loading={toggling}
                  onClick={() => void toggle(true)}
                >
                  Resume orders
                </Button>
              )
            ) : null}
          </div>
        ) : null}
      </div>

      {data && !data.canteen.isActive ? (
        <div className="notice notice-danger" role="status">
          This canteen has been deactivated by an admin. Students cannot place orders until it is
          reactivated.
        </div>
      ) : data && !data.canteen.isAcceptingOrders ? (
        <div className="notice" role="status">
          Order-taking is paused. Students can browse the menu but cannot place new orders.
        </div>
      ) : null}

      {data ? (
        <div className="stats" aria-live="polite">
          <Stat
            label="Awaiting preparation"
            value={data.orders.awaitingPreparation}
            icon={<IconBag width={16} height={16} />}
            accent={data.orders.awaitingPreparation > 0}
          />
          <Stat
            label="Preparing"
            value={data.orders.preparing}
            icon={<IconFlame width={16} height={16} />}
          />
          <Stat
            label="Ready for pickup"
            value={data.orders.ready}
            icon={<IconCheck width={16} height={16} />}
          />
          <Stat
            label="Today's orders"
            value={data.today.orderCount}
            icon={<IconReceipt width={16} height={16} />}
          />
          <Stat label="Today's revenue" value={formatRupees(data.today.revenuePaise)} />
        </div>
      ) : (
        <SkeletonRows rows={2} />
      )}

      <section className="section">
        <div className="section-header">
          <h2>Active orders</h2>
          <Link to="/orders" className="btn btn-secondary btn-sm">
            Open order board
          </Link>
        </div>
        {recent.loading && !recent.data ? (
          <SkeletonRows />
        ) : recent.error && !recent.data ? (
          <ErrorState error={recent.error} onRetry={() => void recent.reload()} />
        ) : recent.data && recent.data.data.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Student</th>
                  <th>Items</th>
                  <th>Total</th>
                  <th>Paid at</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.data.data.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <strong className="order-number">{order.orderNumber}</strong>
                    </td>
                    <td>{order.student.name}</td>
                    <td className="muted">
                      {order.items.reduce((n, item) => n + item.quantity, 0)} items
                    </td>
                    <td className="num">{formatRupees(order.totalPaise)}</td>
                    <td className="muted">{order.paidAt ? formatTime(order.paidAt) : '—'}</td>
                    <td>
                      <StatusPill status={order.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<IconReceipt />}
            title="No active orders"
            body="Paid orders appear here the moment students check out."
          />
        )}
      </section>
    </>
  );
}

function Stat({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number | string;
  icon?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className={`stat${accent ? ' stat-accent' : ''}`}>
      <div className="stat-label">
        {icon}
        {label}
      </div>
      <div className="stat-value">{value}</div>
    </div>
  );
}
