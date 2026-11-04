import { useMemo, useState, type FormEvent } from 'react';
import type { AdminReport, ServicePeriod } from '@serve/contracts';
import {
  Button,
  EmptyState,
  ErrorState,
  KpiStrip,
  Select,
  SkeletonRows,
  formatRupees,
  useResource,
} from '@serve/web-shared';
import { useAdminApi } from '../useAdminApi';

type Filters = {
  from: string;
  to: string;
  canteenId: string;
  servicePeriod: '' | ServicePeriod;
  channel: '' | 'APP' | 'WALK_IN';
  paymentMethod: '' | 'CASH' | 'UPI';
  paymentMode: '' | 'DEMO' | 'LIVE';
};

function istInput(offsetDays: number) {
  const shifted = new Date(Date.now() + (5 * 60 + 30) * 60 * 1000 + offsetDays * 86_400_000);
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${month}-${day}`;
}

function defaultFilters(): Filters {
  return {
    from: istInput(-6),
    to: istInput(0),
    canteenId: '',
    servicePeriod: '',
    channel: '',
    paymentMethod: '',
    paymentMode: '',
  };
}

/** Figures come from `/api/admin/reports`. The page does not total revenue itself. */
export function ReportsPage() {
  const api = useAdminApi();
  const canteens = useResource(() => api.canteens(), [api]);
  const [draft, setDraft] = useState<Filters>(defaultFilters);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const report = useResource(() => api.reports(filters), [api, filters]);

  const apply = (event: FormEvent) => {
    event.preventDefault();
    setFilters(draft);
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Reports & Analytics</h1>
          <p>Successful LIVE sales are the only real revenue. DEMO sales are shown apart from them.</p>
        </div>
      </div>

      <form className="filters" onSubmit={apply}>
        <label className="inline-select">
          <span>From</span>
          <input
            className="input"
            type="date"
            aria-label="From"
            value={draft.from}
            onChange={(event) => setDraft({ ...draft, from: event.target.value })}
          />
        </label>
        <label className="inline-select">
          <span>To</span>
          <input
            className="input"
            type="date"
            aria-label="To"
            value={draft.to}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          />
        </label>
        <label className="inline-select">
          <span>Canteen</span>
          <Select
            aria-label="Canteen"
            value={draft.canteenId}
            onChange={(event) => setDraft({ ...draft, canteenId: event.target.value })}
          >
            <option value="">All canteens</option>
            {(canteens.data ?? []).map((canteen) => (
              <option key={canteen.id} value={canteen.id}>
                {canteen.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="inline-select">
          <span>Service</span>
          <Select
            aria-label="Service period"
            value={draft.servicePeriod}
            onChange={(event) =>
              setDraft({ ...draft, servicePeriod: event.target.value as Filters['servicePeriod'] })
            }
          >
            <option value="">All</option>
            <option value="DAY">Day</option>
            <option value="NIGHT">Night</option>
          </Select>
        </label>
        <label className="inline-select">
          <span>Channel</span>
          <Select
            aria-label="Order channel"
            value={draft.channel}
            onChange={(event) =>
              setDraft({ ...draft, channel: event.target.value as Filters['channel'] })
            }
          >
            <option value="">All</option>
            <option value="APP">App</option>
            <option value="WALK_IN">Walk-in</option>
          </Select>
        </label>
        <label className="inline-select">
          <span>Method</span>
          <Select
            aria-label="Payment method"
            value={draft.paymentMethod}
            onChange={(event) =>
              setDraft({ ...draft, paymentMethod: event.target.value as Filters['paymentMethod'] })
            }
          >
            <option value="">All</option>
            <option value="CASH">Cash</option>
            <option value="UPI">UPI</option>
          </Select>
        </label>
        <label className="inline-select">
          <span>Mode</span>
          <Select
            aria-label="Payment mode"
            value={draft.paymentMode}
            onChange={(event) =>
              setDraft({ ...draft, paymentMode: event.target.value as Filters['paymentMode'] })
            }
          >
            <option value="">All</option>
            <option value="DEMO">DEMO</option>
            <option value="LIVE">LIVE</option>
          </Select>
        </label>
        <Button type="submit" size="sm">
          Apply
        </Button>
      </form>

      {report.loading && !report.data ? (
        <SkeletonRows rows={4} />
      ) : report.error && !report.data ? (
        <ErrorState error={report.error} onRetry={() => void report.reload()} />
      ) : report.data ? (
        <ReportBody report={report.data} />
      ) : null}
    </>
  );
}

function ReportBody({ report }: { report: AdminReport }) {
  const empty =
    report.orders.total === 0 &&
    report.payments.liveSalesPaise === 0 &&
    report.payments.demoSalesPaise === 0 &&
    report.payments.rejected === 0;
  const salesBars = useMemo(
    () =>
      report.series.map((row) => ({
        label: row.date.slice(5),
        value: row.liveSalesPaise,
        display: formatRupees(row.liveSalesPaise),
      })),
    [report.series],
  );

  return (
    <>
      <KpiStrip
        label="Report totals"
        items={[
          { label: 'Total orders', value: report.orders.total },
          { label: 'App orders', value: report.orders.app },
          { label: 'Walk-in orders', value: report.orders.walkIn },
          { label: 'Successful LIVE sales', value: formatRupees(report.payments.liveSalesPaise) },
          { label: 'Cash sales', value: formatRupees(report.payments.cashSalesPaise) },
          { label: 'UPI sales', value: formatRupees(report.payments.upiSalesPaise) },
          { label: 'Cancelled orders', value: report.orders.cancelled },
          { label: 'Rejected payments', value: report.payments.rejected },
        ]}
      />
      <p className="muted small revenue-note">
        DEMO sales in this range: {formatRupees(report.payments.demoSalesPaise)}. They are not
        included in successful LIVE sales.
        {report.payments.otherLiveSalesPaise > 0
          ? ` Other LIVE sales (app checkout): ${formatRupees(report.payments.otherLiveSalesPaise)}.`
          : ''}
      </p>
      {empty ? (
        <EmptyState
          title="No orders in this range"
          body="Adjust the dates or filters. Nothing here is sample data."
        />
      ) : (
        <div className="chart-grid">
          <Chart title="Sales over time" rows={salesBars} scroll emptyLabel="No LIVE sales in this range." />
          <Chart
            title="Canteen-wise sales"
            rows={report.byCanteen.map((row) => ({
              label: row.name,
              value: row.liveSalesPaise,
              display: formatRupees(row.liveSalesPaise),
            }))}
          />
          <Chart
            title="Day vs Night sales"
            rows={report.byPeriod.map((row) => ({
              label: row.period === 'UNSET' ? 'Unset' : row.period === 'DAY' ? 'Day' : 'Night',
              value: row.liveSalesPaise,
              display: formatRupees(row.liveSalesPaise),
            }))}
          />
          <Chart
            title="App vs walk-in orders"
            emptyLabel="No orders in this range."
            rows={report.byChannel.map((row) => ({
              label: row.channel === 'APP' ? 'App' : 'Walk-in',
              value: row.orderCount,
              display: String(row.orderCount),
            }))}
          />
          <Chart
            title="Cash vs UPI sales"
            rows={report.byMethod
              .filter((row) => row.method !== 'OTHER')
              .map((row) => ({
                label: row.method === 'CASH' ? 'Cash' : 'UPI',
                value: row.liveSalesPaise,
                display: formatRupees(row.liveSalesPaise),
              }))}
          />
          <Chart
            title="Best-selling items"
            rows={report.topItems.map((row) => ({
              label: row.name,
              value: row.quantity,
              display: `${row.quantity} · ${formatRupees(row.liveSalesPaise)}`,
            }))}
          />
        </div>
      )}
    </>
  );
}

function Chart({
  title,
  rows,
  scroll = false,
  emptyLabel = 'No LIVE sales in this range.',
}: {
  title: string;
  rows: { label: string; value: number; display: string }[];
  scroll?: boolean;
  emptyLabel?: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  const quiet = rows.length === 0 || rows.every((row) => row.value === 0);
  return (
    <section className="section" aria-label={title}>
      <div className="section-header">
        <h2>{title}</h2>
      </div>
      {quiet ? (
        <p className="muted small chart-empty">{emptyLabel}</p>
      ) : (
        <div className={scroll ? 'bar-list bar-list-scroll' : 'bar-list'}>
          {rows.map((row) => (
            <div key={row.label} className="bar-row">
              <span>{row.label}</span>
              <span className="bar-track" aria-hidden>
                <span className="bar-fill" style={{ width: `${(row.value / max) * 100}%` }} />
              </span>
              <span className="num">{row.display}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
