import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { OrderStatus, StaffOrder } from '@serve/contracts';
import {
  ApiError,
  Button,
  EmptyState,
  ErrorState,
  Field,
  IconBag,
  IconCheck,
  IconFlame,
  IconReceipt,
  Modal,
  SkeletonRows,
  StatusPill,
  TextArea,
  FormError,
  errorMessage,
  formatDateTime,
  formatRupees,
  formatTime,
  timeAgo,
  useRealtime,
  useServerEvent,
  useServerEvents,
  useToast,
} from '@serve/web-shared';
import { NEXT_STATUS, canCancel, type StaffSettableStatus } from '../api/staff';
import { useStaffApi } from '../useStaffApi';

type BoardColumn = { status: OrderStatus; title: string; empty: string; icon: ReactNode };

const COLUMNS: BoardColumn[] = [
  {
    status: 'PAYMENT_CONFIRMED',
    title: 'New',
    empty: 'New paid orders land here.',
    icon: <IconBag width={18} height={18} />,
  },
  {
    status: 'PREPARING',
    title: 'Preparing',
    empty: 'Nothing on the stove.',
    icon: <IconFlame width={18} height={18} />,
  },
  {
    status: 'READY',
    title: 'Ready for pickup',
    empty: 'No orders waiting for pickup.',
    icon: <IconCheck width={18} height={18} />,
  },
];
const ACTIVE: OrderStatus[] = ['PAYMENT_CONFIRMED', 'PREPARING', 'READY'];

/** Keep whichever copy of an order is newest (events and responses can race). */
function upsert(list: StaffOrder[], order: StaffOrder): StaffOrder[] {
  const existing = list.find((o) => o.id === order.id);
  if (existing && existing.updatedAt > order.updatedAt) return list;
  return existing ? list.map((o) => (o.id === order.id ? order : o)) : [...list, order];
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function OrdersPage() {
  const [tab, setTab] = useState<'board' | 'COLLECTED' | 'CANCELLED'>('board');
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Orders</h1>
          <p>Paid orders only. Move each order forward as the kitchen works.</p>
        </div>
        <div className="segmented" role="tablist" aria-label="Order views">
          {(
            [
              ['board', 'Live board'],
              ['COLLECTED', 'Collected'],
              ['CANCELLED', 'Cancelled'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? 'active' : ''}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'board' ? <OrderBoard /> : <OrderHistory key={tab} status={tab} />}
    </>
  );
}

function OrderBoard() {
  const api = useStaffApi();
  const toast = useToast();
  const { connectionEpoch } = useRealtime();
  const now = useNow(30_000);
  const [orders, setOrders] = useState<StaffOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<StaffOrder | null>(null);
  const [cancelling, setCancelling] = useState<StaffOrder | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await api.orders('active', { limit: 100 });
      setOrders(page.data);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  // Initial load and a full refetch after every (re)connection, so nothing missed offline is lost.
  useEffect(() => {
    void load();
  }, [load, connectionEpoch]);

  const apply = useCallback((order: StaffOrder) => {
    setOrders((list) =>
      ACTIVE.includes(order.status) ? upsert(list, order) : list.filter((o) => o.id !== order.id),
    );
    setSelected((current) => (current?.id === order.id ? order : current));
  }, []);

  // `order.payment_confirmed` is the staff new-order signal.
  useServerEvent('order.payment_confirmed', ({ order }) => {
    apply(order);
    setFresh((set) => new Set(set).add(order.id));
    setTimeout(
      () =>
        setFresh((set) => {
          const next = new Set(set);
          next.delete(order.id);
          return next;
        }),
      6000,
    );
    toast(`New order ${order.orderNumber} · ${formatRupees(order.totalPaise)}`, 'info');
  });
  useServerEvents(
    ['order.preparing', 'order.ready', 'order.collected', 'order.cancelled'] as const,
    (_name, { order }) => apply(order),
  );

  const advance = async (order: StaffOrder, status: StaffSettableStatus, reason?: string) => {
    setBusy((b) => ({ ...b, [order.id]: true }));
    try {
      // No optimistic update: the board changes only after the backend confirms the transition.
      const updated = await api.setOrderStatus(order.id, status, reason);
      apply(updated);
      toast(`${updated.orderNumber} · ${statusToast(updated.status)}`);
      return true;
    } catch (err) {
      toast(errorMessage(err), 'error');
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) {
        // Someone else moved it (or it was cancelled): show the server's truth.
        try {
          apply(await api.order(order.id));
        } catch {
          void load();
        }
      }
      return false;
    } finally {
      setBusy((b) => ({ ...b, [order.id]: false }));
    }
  };

  const byStatus = useMemo(() => {
    const groups = new Map<OrderStatus, StaffOrder[]>(ACTIVE.map((s) => [s, []]));
    for (const order of orders) groups.get(order.status)?.push(order);
    // First paid, first served.
    for (const list of groups.values())
      list.sort((a, b) => (a.paidAt ?? a.createdAt).localeCompare(b.paidAt ?? b.createdAt));
    return groups;
  }, [orders]);

  if (loading && orders.length === 0 && !error) return <SkeletonRows rows={6} />;
  if (error && orders.length === 0) return <ErrorState error={error} onRetry={() => void load()} />;

  return (
    <>
      <div className="board" aria-live="polite">
        {COLUMNS.map((column) => {
          const list = byStatus.get(column.status) ?? [];
          return (
            <section
              key={column.status}
              className={`board-column board-${column.status.toLowerCase()}`}
              aria-label={column.title}
            >
              <header className="board-column-header">
                {column.icon}
                <h2>{column.title}</h2>
                <span className="board-count">{list.length}</span>
              </header>
              {list.length === 0 ? (
                <p className="board-empty">{column.empty}</p>
              ) : (
                list.map((order) => {
                  const next = NEXT_STATUS[order.status];
                  return (
                    <article
                      key={order.id}
                      className={`order-card${fresh.has(order.id) ? ' order-card-new' : ''}`}
                    >
                      <button
                        type="button"
                        className="order-card-main"
                        onClick={() => setSelected(order)}
                        aria-label={`Order ${order.orderNumber} details`}
                      >
                        <div className="order-card-top">
                          <span className="order-number">{order.orderNumber}</span>
                          <span className="muted small">
                            {order.paidAt ? timeAgo(order.paidAt, now) : ''}
                          </span>
                        </div>
                        <div className="small">{order.student.name}</div>
                        <ul className="order-card-items">
                          {order.items.map((item) => (
                            <li key={item.id}>
                              <span className="qty">{item.quantity}×</span> {item.itemName}
                            </li>
                          ))}
                        </ul>
                        <div className="order-card-total num">{formatRupees(order.totalPaise)}</div>
                      </button>
                      <div className="order-card-actions">
                        {next ? (
                          <Button
                            size="sm"
                            variant={order.status === 'PAYMENT_CONFIRMED' ? 'accent' : 'primary'}
                            loading={busy[order.id]}
                            onClick={() => void advance(order, next.status)}
                          >
                            {next.label}
                          </Button>
                        ) : null}
                        {canCancel(order.status) ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy[order.id]}
                            onClick={() => setCancelling(order)}
                          >
                            Cancel
                          </Button>
                        ) : null}
                      </div>
                    </article>
                  );
                })
              )}
            </section>
          );
        })}
      </div>

      {selected ? (
        <OrderDetailModal
          order={selected}
          busy={!!busy[selected.id]}
          onClose={() => setSelected(null)}
          onAdvance={(status) => void advance(selected, status)}
          onCancel={() => {
            setCancelling(selected);
            setSelected(null);
          }}
        />
      ) : null}
      {cancelling ? (
        <CancelOrderModal
          order={cancelling}
          onClose={() => setCancelling(null)}
          onConfirm={async (reason) => {
            if (await advance(cancelling, 'CANCELLED', reason)) setCancelling(null);
          }}
        />
      ) : null}
    </>
  );
}

function statusToast(status: OrderStatus) {
  switch (status) {
    case 'PREPARING':
      return 'preparing';
    case 'READY':
      return 'ready for pickup';
    case 'COLLECTED':
      return 'collected';
    case 'CANCELLED':
      return 'cancelled';
    default:
      return status.toLowerCase();
  }
}

const TIMELINE_LABEL: Record<OrderStatus, string> = {
  PLACED: 'Placed',
  PAYMENT_CONFIRMED: 'Payment confirmed',
  PREPARING: 'Preparing',
  READY: 'Ready for pickup',
  COLLECTED: 'Collected',
  CANCELLED: 'Cancelled',
};

export function OrderDetailModal({
  order,
  busy,
  onClose,
  onAdvance,
  onCancel,
}: {
  order: StaffOrder;
  busy?: boolean;
  onClose: () => void;
  onAdvance?: (status: StaffSettableStatus) => void;
  onCancel?: () => void;
}) {
  const next = NEXT_STATUS[order.status];
  return (
    <Modal
      title={`Order ${order.orderNumber}`}
      onClose={onClose}
      footer={
        <>
          {onCancel && canCancel(order.status) ? (
            <Button variant="danger" disabled={busy} onClick={onCancel}>
              Cancel order
            </Button>
          ) : null}
          {onAdvance && next ? (
            <Button loading={busy} onClick={() => onAdvance(next.status)}>
              {next.label}
            </Button>
          ) : (
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          )}
        </>
      }
    >
      <div className="order-detail">
        <div className="order-detail-head">
          <span className="order-number order-number-lg">{order.orderNumber}</span>
          <StatusPill status={order.status} />
        </div>
        <dl className="detail-grid">
          <dt>Student</dt>
          <dd>{order.student.name}</dd>
          <dt>Pickup</dt>
          <dd>{order.canteen.name}</dd>
          <dt>Payment</dt>
          <dd>
            {order.payment
              ? `${order.payment.status === 'SUCCESS' ? 'Paid' : order.payment.status.toLowerCase()} · ${order.payment.provider === 'MOCK' ? 'Test payment' : 'Razorpay'}`
              : '—'}
          </dd>
          {order.cancelReason ? (
            <>
              <dt>Cancel reason</dt>
              <dd>{order.cancelReason}</dd>
            </>
          ) : null}
        </dl>
        <table className="table compact">
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id}>
                <td>
                  <span className="qty">{item.quantity}×</span> {item.itemName}
                </td>
                <td className="num muted">{formatRupees(item.unitPricePaise)}</td>
                <td className="num">{formatRupees(item.lineTotalPaise)}</td>
              </tr>
            ))}
            <tr className="total-row">
              <td colSpan={2}>Total</td>
              <td className="num">{formatRupees(order.totalPaise)}</td>
            </tr>
          </tbody>
        </table>
        <ol className="timeline">
          {order.timeline.map((step) => (
            <li key={step.status}>
              <span className="timeline-dot" aria-hidden />
              <span>{TIMELINE_LABEL[step.status]}</span>
              <time className="muted small" dateTime={step.at}>
                {formatTime(step.at)}
              </time>
            </li>
          ))}
        </ol>
      </div>
    </Modal>
  );
}

function CancelOrderModal({
  order,
  onClose,
  onConfirm,
}: {
  order: StaffOrder;
  onClose: () => void;
  onConfirm: (reason?: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={`Cancel ${order.orderNumber}?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Keep order
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await onConfirm(reason.trim() || undefined);
              setBusy(false);
            }}
          >
            Cancel order
          </Button>
        </>
      }
    >
      <div className="form">
        <p>
          {order.student.name} paid {formatRupees(order.totalPaise)}. Cancelling refunds the payment
          and notifies the student. This cannot be undone.
        </p>
        <Field label="Reason (shown to the student)" hint="For example: item ran out">
          {(p) => (
            <TextArea
              {...p}
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Modal>
  );
}

function OrderHistory({ status }: { status: 'COLLECTED' | 'CANCELLED' }) {
  const api = useStaffApi();
  const { connectionEpoch } = useRealtime();
  const [orders, setOrders] = useState<StaffOrder[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<StaffOrder | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await api.orders(status, { limit: 25 });
      setOrders(page.data);
      setCursor(page.nextCursor);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [api, status]);

  useEffect(() => {
    void load();
  }, [load, connectionEpoch]);

  useServerEvent(status === 'COLLECTED' ? 'order.collected' : 'order.cancelled', ({ order }) =>
    setOrders((list) => (list.some((o) => o.id === order.id) ? list : [order, ...list])),
  );

  const more = async () => {
    if (!cursor) return;
    try {
      const page = await api.orders(status, { limit: 25, cursor });
      setOrders((list) => [...list, ...page.data]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <section className="section">
      {loading && orders.length === 0 ? (
        <SkeletonRows />
      ) : error && orders.length === 0 ? (
        <ErrorState error={error} onRetry={() => void load()} />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={<IconReceipt />}
          title={status === 'COLLECTED' ? 'No collected orders yet' : 'No cancelled orders'}
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Student</th>
                <th>Total</th>
                <th>{status === 'COLLECTED' ? 'Collected' : 'Cancelled'}</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="clickable" onClick={() => setSelected(order)}>
                  <td>
                    <button
                      type="button"
                      className="link-button order-number"
                      onClick={() => setSelected(order)}
                    >
                      {order.orderNumber}
                    </button>
                  </td>
                  <td>{order.student.name}</td>
                  <td className="num">{formatRupees(order.totalPaise)}</td>
                  <td className="muted">
                    {formatDateTime(
                      (status === 'COLLECTED' ? order.collectedAt : order.cancelledAt) ??
                        order.updatedAt,
                    )}
                  </td>
                  <td>
                    <StatusPill status={order.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && orders.length > 0 ? <FormError error={error} /> : null}
      {cursor ? (
        <div className="section-body center">
          <Button variant="ghost" onClick={() => void more()}>
            Load more
          </Button>
        </div>
      ) : null}
      {selected ? <OrderDetailModal order={selected} onClose={() => setSelected(null)} /> : null}
    </section>
  );
}
