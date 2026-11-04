import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ORDER_EVENT_NAMES, type AdminDashboard, type StaffOrder } from '@serve/contracts';
import {
  EmptyState,
  ErrorState,
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

function serviceTag(configured: boolean, enabled: boolean, open: boolean) {
  if (!configured) return <Tag>Not set</Tag>;
  if (!enabled) return <Tag>Off</Tag>;
  return open ? <Tag tone="success">Open</Tag> : <Tag tone="warning">Closed</Tag>;
}

function acceptanceTag(row: AdminDashboard['canteenOverview'][number]) {
  if (!row.isActive) return <Tag tone="danger">Inactive</Tag>;
  return row.isAcceptingOrders ? (
    <Tag tone="success">Accepting</Tag>
  ) : (
    <Tag tone="warning">Paused</Tag>
  );
}

function party(order: StaffOrder) {
  if (order.channel === 'WALK_IN') {
    return order.guestName ? `Walk-in · ${order.guestName}` : 'Walk-in';
  }
  return order.student?.name ?? 'Student';
}

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
          <p>University canteens, live.</p>
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
            label="University today"
            items={[
              { label: 'Total canteens', value: d.canteens.total, to: '/canteens' },
              { label: 'Open services', value: d.services.openNow },
              {
                label: 'Active orders',
                value: d.orders.active,
                icon: <IconReceipt width={16} height={16} />,
              },
              { label: "Today's app orders", value: d.today.appOrderCount },
              { label: "Today's walk-in orders", value: d.today.walkInOrderCount },
              { label: "Today's revenue", value: formatRupees(d.today.revenuePaise) },
            ]}
          />
          <p className="muted small revenue-note">
            Today’s revenue counts successful LIVE payments only. DEMO, pending, rejected, cancelled,
            and refunded payments are excluded.
          </p>

          <div className="dashboard-columns three">
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
                { label: 'Day services on', value: d.services.dayEnabled },
                { label: 'Night services on', value: d.services.nightEnabled },
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
                { label: 'Assignments', value: d.staff.assignments },
                { label: 'Cashiers', value: d.staff.cashiers },
              ]}
            />
            <SummaryPanel
              title="Orders"
              link={{ to: '/reports', label: 'View reports' }}
              rows={[
                {
                  label: 'Awaiting preparation',
                  value: d.orders.awaitingPreparation,
                  tag: d.orders.awaitingPreparation ? <Tag tone="warning">Queue</Tag> : null,
                },
                { label: 'Preparing', value: d.orders.preparing },
                { label: 'Ready for pickup', value: d.orders.ready },
                { label: 'Paid LIVE orders', value: d.today.orderCount },
              ]}
            />
          </div>

          {d.payments.demo > 0 ? (
            <p className="notice notice-info" role="status">
              {d.payments.demo} {d.payments.demo === 1 ? 'canteen is' : 'canteens are'} in DEMO mode.
              That is expected while a canteen is used for testing, and those payments are not real
              revenue.
            </p>
          ) : null}
          {d.payments.incompleteLive > 0 ? (
            <p className="notice" role="alert">
              {d.payments.incompleteLive} LIVE{' '}
              {d.payments.incompleteLive === 1 ? 'canteen is' : 'canteens are'} missing official UPI
              or QR details.
              <Link to="/payments"> Review payments</Link>
            </p>
          ) : null}

          <section className="section">
            <div className="section-header">
              <h2>Canteen overview</h2>
            </div>
            {d.canteenOverview.length === 0 ? (
              <EmptyState title="No canteens yet" body="Create a canteen to see its services here." />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Canteen</th>
                      <th>Day</th>
                      <th>Night</th>
                      <th>Orders</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.canteenOverview.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <Link to={`/canteens/${row.id}`} className="item-name">
                            {row.name}
                          </Link>
                        </td>
                        <td>{serviceTag(row.dayConfigured, row.dayEnabled, row.dayOpen)}</td>
                        <td>{serviceTag(row.nightConfigured, row.nightEnabled, row.nightOpen)}</td>
                        <td>{acceptanceTag(row)}</td>
                        <td>{row.isActive ? <Tag tone="success">Active</Tag> : <Tag>Inactive</Tag>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
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
                  <th>Customer</th>
                  <th>Service</th>
                  <th>Total</th>
                  <th>Placed</th>
                  <th>Status</th>
                  <th>Payment</th>
                </tr>
              </thead>
              <tbody>
                {recent.data.data.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <strong className="order-number">{order.orderNumber}</strong>
                    </td>
                    <td>{order.canteen.name}</td>
                    <td>{party(order)}</td>
                    <td>{order.servicePeriod ?? '—'}</td>
                    <td className="num">{formatRupees(order.totalPaise)}</td>
                    <td className="muted">{formatTime(order.createdAt)}</td>
                    <td>
                      <StatusPill status={order.status} />
                    </td>
                    <td>
                      {!order.payment ? (
                        '—'
                      ) : order.payment.isSimulated ? (
                        <Tag>DEMO</Tag>
                      ) : (
                        <Tag tone="success">LIVE</Tag>
                      )}
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
