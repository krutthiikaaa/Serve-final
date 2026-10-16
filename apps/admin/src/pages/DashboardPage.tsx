import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ORDER_EVENT_NAMES } from '@serve/contracts';
import {
  EmptyState,
  ErrorState,
  IconBag,
  IconCheck,
  IconFlame,
  IconInbox,
  IconReceipt,
  KpiStrip,
  SkeletonRows,
  StatusPill,
  Tag,
  formatRupees,
  formatTime,
  useRealtime,
  useResource,
  useServerEvents,
} from '@serve/web-shared';
import { useAdminApi } from '../useAdminApi';

/** Platform overview. Every figure is computed by the backend (`/api/admin/dashboard`). */
export function DashboardPage() {
  const api = useAdminApi();
  const { connectionEpoch } = useRealtime();
  const dashboard = useResource(() => api.dashboard(), [api, connectionEpoch]);
  const recent = useResource(() => api.orders({ limit: 10 }), [api, connectionEpoch]);

  useServerEvents(
    [
      ...ORDER_EVENT_NAMES,
      'change_request.created',
      'change_request.updated',
      'staff.approved',
      'staff.rejected',
      'staff.deactivated',
      'canteen.status_changed',
    ] as const,
    (name) => {
      void dashboard.reload();
      if (name.startsWith('order.')) void recent.reload();
    },
  );

  if (dashboard.error && !dashboard.data)
    return <ErrorState error={dashboard.error} onRetry={() => void dashboard.reload()} />;
  const d = dashboard.data;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>All night canteens, live.</p>
        </div>
      </div>

      {d ? (
        <>
          {d.pendingChangeRequests > 0 ? (
            <div className="notice notice-info notice-row" role="status">
              <IconInbox width={18} height={18} />
              <span>
                {d.pendingChangeRequests} staff{' '}
                {d.pendingChangeRequests === 1 ? 'request is' : 'requests are'} waiting for review.
              </span>
              <Link to="/change-requests" className="btn btn-primary btn-sm">
                Review now
              </Link>
            </div>
          ) : null}

          <KpiStrip
            label="Orders tonight"
            items={[
              {
                label: 'Active orders',
                value: d.orders.active,
                icon: <IconReceipt width={16} height={16} />,
              },
              {
                label: 'Awaiting preparation',
                value: d.orders.awaitingPreparation,
                icon: <IconBag width={16} height={16} />,
                attention: d.orders.awaitingPreparation > 0,
              },
              {
                label: 'Preparing',
                value: d.orders.preparing,
                icon: <IconFlame width={16} height={16} />,
              },
              {
                label: 'Ready for pickup',
                value: d.orders.ready,
                icon: <IconCheck width={16} height={16} />,
              },
              { label: "Today's orders", value: d.today.orderCount },
              { label: "Today's revenue", value: formatRupees(d.today.revenuePaise) },
            ]}
          />

          <div className="dashboard-columns">
            <SummaryPanel
              title="Canteens"
              link={{ to: '/canteens', label: 'Manage canteens' }}
              rows={[
                {
                  label: 'Accepting orders',
                  value: d.canteens.acceptingOrders,
                  tag: <Tag tone="success">Open</Tag>,
                },
                {
                  label: 'Paused',
                  value: d.canteens.paused,
                  tag: d.canteens.paused ? <Tag tone="warning">Paused</Tag> : null,
                },
                { label: 'Inactive', value: d.canteens.inactive },
                { label: 'Total', value: d.canteens.total },
              ]}
            />
            <SummaryPanel
              title="Staff"
              link={{ to: '/staff', label: 'Manage staff' }}
              rows={[
                { label: 'Active', value: d.staff.active },
                {
                  label: 'Pending',
                  value: d.staff.pending,
                  tag: d.staff.pending ? <Tag tone="warning">Awaiting approval</Tag> : null,
                },
                {
                  label: 'Pending requests',
                  value: d.pendingChangeRequests,
                  tag: d.pendingChangeRequests ? <Tag tone="warning">To review</Tag> : null,
                },
                { label: 'Deactivated', value: d.staff.deactivated },
              ]}
            />
          </div>
        </>
      ) : (
        <SkeletonRows rows={3} />
      )}

      <section className="section">
        <div className="section-header">
          <h2>Latest orders</h2>
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
                  <th>Canteen</th>
                  <th>Student</th>
                  <th>Total</th>
                  <th>Placed</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.data.data.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <strong className="order-number">{order.orderNumber}</strong>
                    </td>
                    <td>{order.canteen.name}</td>
                    <td>{order.student.name}</td>
                    <td className="num">{formatRupees(order.totalPaise)}</td>
                    <td className="muted">{formatTime(order.createdAt)}</td>
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
            title="No orders yet"
            body="Orders from every canteen appear here as students place them."
          />
        )}
      </section>
    </>
  );
}

function SummaryPanel({
  title,
  link,
  rows,
}: {
  title: string;
  link: { to: string; label: string };
  rows: { label: string; value: number; tag?: ReactNode }[];
}) {
  return (
    <section className="section" aria-label={title}>
      <div className="section-header">
        <h2>{title}</h2>
        <Link to={link.to} className="btn btn-ghost btn-sm">
          {link.label}
        </Link>
      </div>
      <ul className="plain-list summary-list">
        {rows.map((row) => (
          <li key={row.label} className="summary-row">
            <span className="summary-label">
              {row.label}
              {row.tag}
            </span>
            <strong className="num">{row.value}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}
