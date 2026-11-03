import { useEffect, useMemo, useState } from 'react';
import type { MenuItem, Receipt, ServicePeriod, StaffOrder } from '@serve/contracts';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  Input,
  Modal,
  Select,
  SkeletonRows,
  Tag,
  errorMessage,
  formatDateTime,
  formatRupees,
  timeAgo,
  useRealtime,
  useResource,
  useServerEvents,
  useToast,
} from '@serve/web-shared';
import { useStaffApi } from '../useStaffApi';
import { useStaffCanteen } from '../staffCanteen';
import { ReceiptTicket } from '../components/ReceiptTicket';

type Tab = 'pending' | 'pos' | 'history';

export function CashierPage() {
  const api = useStaffApi();
  const { hasCapability, canteenId, assignment } = useStaffCanteen();
  const { connectionEpoch } = useRealtime();
  const [tab, setTab] = useState<Tab>('pending');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const payConfig = useResource(() => api.paymentConfig(), [api, canteenId, connectionEpoch]);
  const isDemo = payConfig.data?.mode !== 'LIVE';

  if (!hasCapability('CASHIER')) {
    return (
      <EmptyState
        title="Cashier tools are not assigned"
        body="An admin can add the cashier capability for this canteen."
      />
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Cashier</h1>
          <p>Payments and walk-in billing at {assignment?.canteen.name}</p>
        </div>
        {isDemo ? <Tag tone="warning">DEMO mode</Tag> : <Tag tone="success">LIVE</Tag>}
      </div>
      {isDemo ? (
        <div className="notice" role="status">
          DEMO mode — simulated payments only. These are not real collected money.
        </div>
      ) : null}
      <div className="segmented no-print" role="tablist" aria-label="Cashier tools">
        {(['pending', 'pos', 'history'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? 'active' : ''}
            onClick={() => setTab(value)}
          >
            {value === 'pending' ? 'Payment pending' : value === 'pos' ? 'Walk-in POS' : 'History'}
          </button>
        ))}
      </div>
      {tab === 'pending' ? (
        <PendingQueue canteenId={canteenId} isDemo={isDemo} onReceipt={setReceipt} />
      ) : tab === 'pos' ? (
        <WalkInPos canteenId={canteenId} isDemo={isDemo} onReceipt={setReceipt} />
      ) : (
        <SalesHistory canteenId={canteenId} onReceipt={setReceipt} />
      )}
      {receipt ? (
        <Modal title={`Receipt ${receipt.receiptNumber}`} onClose={() => setReceipt(null)}>
          <ReceiptTicket receipt={receipt} />
        </Modal>
      ) : null}
    </>
  );
}

function PendingQueue({
  canteenId,
  isDemo,
  onReceipt,
}: {
  canteenId: string;
  isDemo: boolean;
  onReceipt: (receipt: Receipt) => void;
}) {
  const api = useStaffApi();
  const toast = useToast();
  const { connectionEpoch } = useRealtime();
  const pending = useResource(() => api.pendingPayments(), [api, canteenId, connectionEpoch]);
  const [acting, setActing] = useState<StaffOrder | null>(null);
  const [mode, setMode] = useState<'confirm' | 'reject' | 'view' | null>(null);
  const [utr, setUtr] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useServerEvents(['order.created', 'order.payment_confirmed', 'order.cancelled'] as const, () => {
    void pending.reload();
  });

  const open = (order: StaffOrder, next: 'confirm' | 'reject' | 'view') => {
    setActing(order);
    setMode(next);
    setUtr(order.payment?.utr ?? '');
    setReason('');
  };

  const close = () => {
    setActing(null);
    setMode(null);
    setBusy(false);
  };

  const confirm = async () => {
    if (!acting) return;
    setBusy(true);
    try {
      const result = isDemo
        ? await api.confirmDemoPayment(acting.id, {
            simulatedPaymentReceived: true,
            utr: utr.trim() || acting.payment?.utr,
          })
        : await api.confirmPayment(acting.id, {
            paymentReceived: true,
            utr: utr.trim() || acting.payment?.utr,
          });
      toast(
        isDemo
          ? `Demo payment recorded for ${result.order.orderNumber}`
          : `Payment confirmed for ${result.order.orderNumber}`,
      );
      onReceipt(result.receipt);
      close();
      await pending.reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!acting) return;
    setBusy(true);
    try {
      await api.rejectPayment(acting.id, reason.trim() || undefined);
      toast(`Payment rejected for ${acting.orderNumber}`);
      close();
      await pending.reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
      setBusy(false);
    }
  };

  if (pending.loading && !pending.data) return <SkeletonRows rows={4} />;
  if (pending.error && !pending.data)
    return <ErrorState error={pending.error} onRetry={() => void pending.reload()} />;

  const rows = pending.data?.data ?? [];

  return (
    <section className="section">
      {rows.length === 0 ? (
        <EmptyState title="No payments waiting" body="New app orders stay here until you confirm actual UPI credit." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Student</th>
                <th>Items</th>
                <th>Total</th>
                <th>Method</th>
                <th>UTR</th>
                <th>Status</th>
                <th>Waiting</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => (
                <tr key={order.id}>
                  <td>
                    <strong className="order-number">{order.orderNumber}</strong>
                    <div className="muted small">
                      Token {order.orderNumber} · {order.canteen.name} · {order.servicePeriod ?? '—'}
                    </div>
                  </td>
                  <td>{order.student?.name ?? '—'}</td>
                  <td className="muted">
                    {order.items.map((item) => `${item.quantity}× ${item.itemName}`).join(', ')}
                  </td>
                  <td className="num">{formatRupees(order.totalPaise)}</td>
                  <td>{order.payment?.provider ?? '—'}</td>
                  <td>{order.payment?.utr ?? '—'}</td>
                  <td>
                    <Tag tone="warning">{order.payment?.status ?? 'PENDING'}</Tag>
                  </td>
                  <td className="muted">{timeAgo(order.createdAt)}</td>
                  <td>
                    <div className="row-actions">
                      <Button size="sm" variant="secondary" onClick={() => open(order, 'view')}>
                        View
                      </Button>
                      <Button size="sm" onClick={() => open(order, 'confirm')}>
                        {isDemo ? 'Simulate' : 'Confirm'}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => open(order, 'reject')}>
                        Reject
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {acting && mode === 'view' ? (
        <Modal title={`Order ${acting.orderNumber}`} onClose={close}>
          <p className="muted small">{acting.canteen.name} · {acting.servicePeriod ?? '—'}</p>
          <ul>
            {acting.items.map((item) => (
              <li key={item.id}>
                {item.quantity}× {item.itemName} — {formatRupees(item.lineTotalPaise)}
              </li>
            ))}
          </ul>
          <p>
            <strong>{formatRupees(acting.totalPaise)}</strong>
            {acting.payment?.utr ? ` · UTR ${acting.payment.utr}` : ''}
          </p>
          <p className="muted small">A submitted UTR is supporting information, not proof of payment.</p>
        </Modal>
      ) : null}

      {acting && mode === 'confirm' ? (
        <Modal
          title={
            isDemo
              ? `Simulate DEMO payment for ${acting.orderNumber}`
              : `Confirm payment for ${acting.orderNumber}`
          }
          onClose={close}
          footer={
            <>
              <Button variant="secondary" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button loading={busy} onClick={() => void confirm()}>
                {isDemo ? 'Simulate payment received' : 'I verified the credit'}
              </Button>
            </>
          }
        >
          <p>
            {isDemo
              ? 'This records a simulated DEMO payment. No real money is collected.'
              : 'Confirm only after checking the merchant account or official records.'}{' '}
            Total <strong>{formatRupees(acting.totalPaise)}</strong>.
          </p>
          <Field label="UTR / reference (optional)">
            {(p) => <Input {...p} value={utr} onChange={(e) => setUtr(e.target.value)} />}
          </Field>
        </Modal>
      ) : null}

      {acting && mode === 'reject' ? (
        <Modal
          title={`Reject payment for ${acting.orderNumber}`}
          onClose={close}
          footer={
            <>
              <Button variant="secondary" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button variant="danger" loading={busy} onClick={() => void reject()}>
                Reject payment
              </Button>
            </>
          }
        >
          <p>Rejected payments do not go to the kitchen.</p>
          <Field label="Reason (optional)">
            {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
        </Modal>
      ) : null}
    </section>
  );
}

function WalkInPos({
  canteenId,
  isDemo,
  onReceipt,
}: {
  canteenId: string;
  isDemo: boolean;
  onReceipt: (receipt: Receipt) => void;
}) {
  const api = useStaffApi();
  const toast = useToast();
  const { connectionEpoch } = useRealtime();
  const [period, setPeriod] = useState<ServicePeriod>('NIGHT');
  const [categoryId, setCategoryId] = useState('all');
  const [method, setMethod] = useState<'CASH' | 'UPI'>('CASH');
  const [guestName, setGuestName] = useState('');
  const [utr, setUtr] = useState('');
  const [lines, setLines] = useState<{ item: MenuItem; quantity: number }[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const menu = useResource(() => api.posMenu(period), [api, canteenId, period, connectionEpoch]);

  const categories = useMemo(() => {
    const seen = new Set<string>();
    return (menu.data?.categories ?? []).filter((category) => {
      if (!category.items.length || seen.has(category.id)) return false;
      seen.add(category.id);
      return true;
    });
  }, [menu.data]);

  useEffect(() => {
    if (categoryId !== 'all' && !categories.some((category) => category.id === categoryId)) {
      setCategoryId('all');
    }
  }, [categories, categoryId]);

  const items = useMemo(() => {
    const visible = categoryId === 'all' ? categories : categories.filter((c) => c.id === categoryId);
    return visible.flatMap((category) => category.items);
  }, [categories, categoryId]);
  const hasItems = lines.length > 0;
  const totalPaise = lines.reduce((sum, line) => sum + line.item.pricePaise * line.quantity, 0);

  const add = (item: MenuItem) => {
    setLines((current) => {
      const existing = current.find((line) => line.item.id === item.id);
      if (existing) {
        return current.map((line) =>
          line.item.id === item.id ? { ...line, quantity: Math.min(20, line.quantity + 1) } : line,
        );
      }
      return [...current, { item, quantity: 1 }];
    });
  };

  const complete = async () => {
    setBusy(true);
    setError(null);
    try {
      const items = lines.map((line) => ({ menuItemId: line.item.id, quantity: line.quantity }));
      const result = isDemo
        ? await api.completeDemoWalkIn({
            servicePeriod: period,
            paymentMethod: method,
            simulatedPaymentReceived: true,
            guestName: guestName.trim() || null,
            utr: method === 'UPI' ? utr.trim() || null : null,
            items,
          })
        : await api.completeWalkIn({
            servicePeriod: period,
            paymentMethod: method,
            paymentReceived: true,
            guestName: guestName.trim() || null,
            utr: method === 'UPI' ? utr.trim() || null : null,
            items,
          });
      toast(
        isDemo
          ? `Demo bill ${result.order.orderNumber} recorded`
          : `Bill ${result.order.orderNumber} completed`,
      );
      onReceipt(result.receipt);
      setLines([]);
      setGuestName('');
      setUtr('');
      setConfirming(false);
    } catch (err) {
      setError(err);
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pos-layout">
      <section className="section pos-menu">
        <div className="section-header">
          <h2>Menu</h2>
          <div className="segmented" role="tablist" aria-label="Service period">
            {(['DAY', 'NIGHT'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={period === value}
                className={period === value ? 'active' : ''}
                onClick={() => {
                  setPeriod(value);
                  setCategoryId('all');
                  setLines([]);
                }}
              >
                {value === 'DAY' ? 'Day' : 'Night'}
              </button>
            ))}
          </div>
        </div>
        {menu.loading && !menu.data ? (
          <SkeletonRows />
        ) : menu.error && !menu.data ? (
          <ErrorState error={menu.error} onRetry={() => void menu.reload()} />
        ) : (
          <>
            <div className="pos-categories" role="toolbar" aria-label="Menu categories">
              <button
                type="button"
                aria-pressed={categoryId === 'all'}
                className={categoryId === 'all' ? 'active' : ''}
                onClick={() => setCategoryId('all')}
              >
                All
              </button>
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  aria-pressed={categoryId === category.id}
                  className={categoryId === category.id ? 'active' : ''}
                  onClick={() => setCategoryId(category.id)}
                >
                  {category.name}
                </button>
              ))}
            </div>
            {items.length === 0 ? (
              <EmptyState
                title={categories.length === 0 ? 'No items on this menu' : 'No items in this category'}
                body="Switch category or service period to see available dishes."
              />
            ) : (
              <div className="table-wrap">
                <table className="table pos-menu-table">
                  <colgroup>
                    <col />
                    <col className="col-price" />
                    <col className="col-add" />
                  </colgroup>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id} className={item.isOrderable ? undefined : 'row-muted'}>
                        <td>
                          <div className="pos-menu-item">
                            <span className="item-name">{item.name}</span>
                            {item.isOrderable ? null : <Tag tone="warning">Unavailable</Tag>}
                          </div>
                        </td>
                        <td className="num">{formatRupees(item.pricePaise)}</td>
                        <td>
                          <Button
                            size="sm"
                            variant="secondary"
                            aria-label={`Add ${item.name}`}
                            onClick={() => add(item)}
                            disabled={!item.isOrderable}
                          >
                            Add
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
      <section className="section pos-bill">
        <div className="section-header">
          <h2>Current Bill</h2>
        </div>
        <div className="section-body pos-bill-body">
          {hasItems ? (
            <ul className="pos-bill-lines">
              {lines.map((line) => (
                <li key={line.item.id} className="pos-bill-line">
                  <div className="pos-bill-item">
                    <span className="pos-bill-name">{line.item.name}</span>
                    <span className="pos-bill-unit">{formatRupees(line.item.pricePaise)}</span>
                  </div>
                  <div className="pos-qty">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="pos-qty-btn"
                      aria-label={`Decrease ${line.item.name}`}
                      onClick={() =>
                        setLines((current) =>
                          current.flatMap((row) => {
                            if (row.item.id !== line.item.id) return [row];
                            if (row.quantity <= 1) return [];
                            return [{ ...row, quantity: row.quantity - 1 }];
                          }),
                        )
                      }
                    >
                      −
                    </Button>
                    <span className="pos-qty-value" aria-live="polite">
                      {line.quantity}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="pos-qty-btn"
                      aria-label={`Increase ${line.item.name}`}
                      onClick={() => add(line.item)}
                    >
                      +
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="pos-bill-empty">
              <EmptyState
                title="Empty bill"
                body="Add items from the menu. Prices come from the server when you complete."
              />
            </div>
          )}
          <p className="pos-bill-total">
            <span>Estimated total</span>
            <strong>{formatRupees(totalPaise)}</strong>
          </p>
          <Field label="Guest name (optional)">
            {(p) => (
              <Input
                {...p}
                autoComplete="name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
              />
            )}
          </Field>
          {hasItems ? (
            <>
              <div className="pos-method-field">
                <p className="pos-method-label" id="pos-payment-method">
                  Payment method
                </p>
                <div
                  className="pos-method"
                  role="radiogroup"
                  aria-labelledby="pos-payment-method"
                >
                  {(['CASH', 'UPI'] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={method === value}
                      className={method === value ? 'active' : ''}
                      onClick={() => setMethod(value)}
                    >
                      {value === 'CASH' ? 'Cash' : 'UPI'}
                    </button>
                  ))}
                </div>
              </div>
              {method === 'UPI' ? (
                <p className="pos-upi-note">
                  Ask the customer to scan the QR displayed separately at the counter. Verify the
                  payment in the merchant account before confirming.
                </p>
              ) : null}
              {isDemo ? (
                <p className="notice" role="status">
                  DEMO TRANSACTION — NO REAL PAYMENT
                </p>
              ) : null}
              {method === 'UPI' ? (
                <Field label="UTR / reference (optional)">
                  {(p) => <Input {...p} value={utr} onChange={(e) => setUtr(e.target.value)} />}
                </Field>
              ) : null}
            </>
          ) : null}
          <Button
            className="pos-complete"
            disabled={!hasItems}
            onClick={() => setConfirming(true)}
          >
            Complete bill
          </Button>
        </div>
      </section>

      {confirming ? (
        <Modal
          title={isDemo ? 'Record simulated DEMO sale' : 'Confirm payment received'}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </Button>
              <Button loading={busy} onClick={() => void complete()}>
                {isDemo
                  ? 'Simulate payment received'
                  : method === 'CASH'
                    ? 'Cash received'
                    : 'UPI credit verified'}
              </Button>
            </>
          }
        >
          <FormError error={error} />
          <p>
            {isDemo
              ? 'This is a simulated DEMO sale. It must not be treated as real collected money.'
              : `Selecting ${method} is not proof of payment. Confirm only after ${
                  method === 'CASH' ? 'the cash is in the till' : 'the credit appears on the merchant account'
                }.`}
          </p>
        </Modal>
      ) : null}
    </div>
  );
}

function SalesHistory({
  canteenId,
  onReceipt,
}: {
  canteenId: string;
  onReceipt: (receipt: Receipt) => void;
}) {
  const api = useStaffApi();
  const toast = useToast();
  const [channel, setChannel] = useState<'APP' | 'WALK_IN' | ''>('');
  const [method, setMethod] = useState<'CASH' | 'UPI' | ''>('');
  const [period, setPeriod] = useState<ServicePeriod | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [simulated, setSimulated] = useState<'all' | 'true' | 'false'>('all');
  const dateRangeInvalid = Boolean(from && to && from > to);
  const filtersActive = Boolean(channel || method || period || from || to || simulated !== 'all');
  const sales = useResource(
    () =>
      dateRangeInvalid
        ? Promise.resolve({ data: [] as StaffOrder[], nextCursor: null })
        : api.sales({
            channel: channel || undefined,
            method: method || undefined,
            period: period || undefined,
            simulated: simulated === 'all' ? undefined : simulated === 'true',
            from: from ? new Date(`${from}T00:00:00.000+05:30`).toISOString() : undefined,
            to: to ? new Date(`${to}T23:59:59.999+05:30`).toISOString() : undefined,
          }),
    [api, canteenId, channel, method, period, simulated, from, to, dateRangeInvalid],
  );

  const clearFilters = () => {
    setChannel('');
    setMethod('');
    setPeriod('');
    setFrom('');
    setTo('');
    setSimulated('all');
  };

  const openReceipt = async (id: string) => {
    try {
      onReceipt(await api.receipt(id));
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <section className="section history-card">
      <div className="section-header history-header">
        <h2>Billing history</h2>
      </div>
      <div className="history-filters">
        <Field label="Channel">
          {(p) => (
            <Select {...p} value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
              <option value="">All channels</option>
              <option value="APP">App</option>
              <option value="WALK_IN">Walk-in</option>
            </Select>
          )}
        </Field>
        <Field label="Payment method">
          {(p) => (
            <Select {...p} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              <option value="">All methods</option>
              <option value="CASH">Cash</option>
              <option value="UPI">UPI</option>
            </Select>
          )}
        </Field>
        <Field label="Service period">
          {(p) => (
            <Select {...p} value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
              <option value="">All periods</option>
              <option value="DAY">Day</option>
              <option value="NIGHT">Night</option>
            </Select>
          )}
        </Field>
        <Field label="Payment mode">
          {(p) => (
            <Select
              {...p}
              value={simulated}
              onChange={(e) => setSimulated(e.target.value as typeof simulated)}
            >
              <option value="all">All modes</option>
              <option value="true">Demo</option>
              <option value="false">Live</option>
            </Select>
          )}
        </Field>
        <Field label="From date" error={dateRangeInvalid ? 'Start date cannot be after end date.' : undefined}>
          {(p) => <Input {...p} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}
        </Field>
        <Field label="To date">
          {(p) => <Input {...p} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}
        </Field>
        <Button
          size="sm"
          variant="secondary"
          className="history-clear"
          onClick={clearFilters}
          disabled={!filtersActive}
        >
          Clear filters
        </Button>
      </div>
      {dateRangeInvalid ? (
        <EmptyState
          title="Invalid date range"
          body="Choose a start date that is on or before the end date."
        />
      ) : sales.loading && !sales.data ? (
        <SkeletonRows />
      ) : sales.error ? (
        <ErrorState error={sales.error} onRetry={() => void sales.reload()} />
      ) : (sales.data?.data.length ?? 0) === 0 ? (
        <EmptyState
          title="No matching transactions"
          body="Only confirmed payments appear here. Pending, rejected and cancelled bills are excluded."
        />
      ) : (
        <div className="table-wrap">
          <table className="table history-table">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Type</th>
                <th>Date</th>
                <th>Period</th>
                <th>Method</th>
                <th>Amount</th>
                <th>Mode</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sales.data!.data.map((order) => (
                <tr key={order.id}>
                  <td>
                    <strong className="order-number">{order.receiptNumber ?? order.orderNumber}</strong>
                  </td>
                  <td>{order.channel === 'WALK_IN' ? 'Walk-in' : 'App'}</td>
                  <td className="nowrap">{formatDateTime(order.paidAt ?? order.createdAt)}</td>
                  <td>{formatServicePeriod(order.servicePeriod)}</td>
                  <td>{formatPaymentMethod(order.payment?.provider)}</td>
                  <td className="num">{formatRupees(order.totalPaise)}</td>
                  <td>
                    {order.payment?.isSimulated ? <Tag tone="warning">DEMO</Tag> : <Tag tone="success">LIVE</Tag>}
                  </td>
                  <td>
                    <Button size="sm" variant="secondary" onClick={() => void openReceipt(order.id)}>
                      Receipt
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function formatPaymentMethod(provider: string | null | undefined) {
  if (provider === 'CASH') return 'Cash';
  if (provider === 'UPI' || provider === 'MOCK' || provider === 'RAZORPAY') return 'UPI';
  return provider ?? '—';
}

function formatServicePeriod(period: StaffOrder['servicePeriod']) {
  if (period === 'DAY') return 'Day';
  if (period === 'NIGHT') return 'Night';
  return '—';
}
