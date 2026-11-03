import { useState } from 'react';
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
  KpiStrip,
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
import { useStaffCanteen } from '../staffCanteen';
import { CanteenStatusTag } from '../components/StaffLayout';

/** Live overview of the assigned canteen. Every number comes from `/api/staff/dashboard`. */
export function DashboardPage() {
  const api = useStaffApi();
  const { hasCapability, canteenId } = useStaffCanteen();
  const { refreshMe } = useAuth();
  const toast = useToast();
  const { connectionEpoch } = useRealtime();
  const canKitchen = hasCapability('KITCHEN');
  const canPause = hasCapability('PAUSE');
  const canCashier = hasCapability('CASHIER');
  const dashboard = useResource(() => api.dashboard(), [api, connectionEpoch, canteenId]);
  const recent = useResource(
    () => (canKitchen ? api.orders('active', { limit: 8 }) : Promise.resolve({ data: [], nextCursor: null })),
    [api, connectionEpoch, canteenId, canKitchen],
  );
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
  const data = dashboard.data?.canteen ? dashboard.data : undefined;

  const accepting = data ? data.canteen.isActive && data.canteen.isAcceptingOrders : false;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Tonight at {data ? data.canteen.name : 'your canteen'}</p>
        </div>
      </div>

      {data ? (
        <section
          className={`section status-banner ${accepting ? 'status-on' : 'status-off'}`}
          aria-label="Canteen status"
        >
          <span className="status-banner-icon" aria-hidden>
            {accepting ? <IconPlay width={18} height={18} /> : <IconPause width={18} height={18} />}
          </span>
          <div className="status-banner-text">
            <div className="section-title">
              <h2>{data.canteen.name}</h2>
              <CanteenStatusTag canteen={data.canteen} />
            </div>
            <p className="muted">
              {!data.canteen.isActive
                ? 'This canteen has been deactivated by an admin. Students cannot place orders until it is reactivated.'
                : data.canteen.isAcceptingOrders
                  ? 'Students can place orders now. New paid orders appear on the order board instantly.'
                  : 'Order-taking is paused. Students can browse the menu but cannot place new orders.'}
            </p>
          </div>
          {data.canteen.isActive && canPause ? (
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
        </section>
      ) : null}

      {data ? (
        <KpiStrip
          label="Tonight's orders"
          items={[
            ...(canKitchen
              ? [
                  {
                    label: 'Awaiting preparation',
                    value: data.orders.awaitingPreparation,
                    icon: <IconBag width={16} height={16} />,
                    attention: data.orders.awaitingPreparation > 0,
                    to: '/orders',
                  },
                  {
                    label: 'Preparing',
                    value: data.orders.preparing,
                    icon: <IconFlame width={16} height={16} />,
                    to: '/orders',
                  },
                  {
                    label: 'Ready for pickup',
                    value: data.orders.ready,
                    icon: <IconCheck width={16} height={16} />,
                    to: '/orders',
                  },
                ]
              : []),
            ...(canCashier
              ? [
                  {
                    label: 'Payment pending',
                    value: data.pendingPayments,
                    icon: <IconBag width={16} height={16} />,
                    attention: data.pendingPayments > 0,
                    to: '/cashier',
                  },
                ]
              : []),
            {
              label: "Today's orders",
              value: data.today.orderCount,
              icon: <IconReceipt width={16} height={16} />,
            },
            { label: "Today's revenue", value: formatRupees(data.today.revenuePaise) },
          ]}
        />
      ) : (
        <SkeletonRows rows={2} />
      )}

      {canKitchen ? (
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
                    <td>{order.student?.name ?? order.guestName ?? 'Walk-in'}</td>
                    <td className="muted">{itemCount(order.items)}</td>
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
      ) : null}
    </>
  );
}

function itemCount(items: { quantity: number }[]): string {
  const n = items.reduce((sum, item) => sum + item.quantity, 0);
  return `${n} ${n === 1 ? 'item' : 'items'}`;
}
