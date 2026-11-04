import { Link, useParams } from 'react-router-dom';
import {
  EmptyState,
  ErrorState,
  KpiStrip,
  SkeletonRows,
  Tag,
  formatDateTime,
  useResource,
} from '@serve/web-shared';
import { useAdminApi } from '../useAdminApi';
import { PaymentSection } from './canteen/PaymentSection';

/** University view of each canteen's own DEMO/LIVE configuration. */
export function PaymentsPage() {
  const api = useAdminApi();
  const overview = useResource(() => api.paymentOverview(), [api]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Payments & QR</h1>
          <p>Each canteen keeps its own UPI details. DEMO payments are not payable.</p>
        </div>
      </div>
      {overview.loading && !overview.data ? (
        <SkeletonRows rows={4} />
      ) : overview.error && !overview.data ? (
        <ErrorState error={overview.error} onRetry={() => void overview.reload()} />
      ) : overview.data ? (
        <>
          <KpiStrip
            label="Payment configuration"
            items={[
              { label: 'Canteens', value: overview.data.totals.canteens },
              { label: 'DEMO', value: overview.data.totals.demo },
              { label: 'LIVE', value: overview.data.totals.live },
              { label: 'Incomplete LIVE', value: overview.data.totals.incompleteLive },
            ]}
          />
          <section className="section">
            {overview.data.canteens.length === 0 ? (
              <EmptyState title="No canteens yet" body="Payment configuration appears here after a canteen is created." />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Canteen</th>
                      <th>Mode</th>
                      <th>Merchant</th>
                      <th>UPI</th>
                      <th>Official QR</th>
                      <th>Updated</th>
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.data.canteens.map((canteen) => (
                      <tr key={canteen.id}>
                        <td className="item-name">{canteen.name}</td>
                        <td>
                          {canteen.mode === 'LIVE' ? (
                            <Tag tone="success">LIVE</Tag>
                          ) : canteen.mode === 'DEMO' ? (
                            <Tag>DEMO</Tag>
                          ) : (
                            <Tag tone="warning">Not configured</Tag>
                          )}
                        </td>
                        <td>{canteen.merchantName ?? '—'}</td>
                        <td>{canteen.upiConfigured ? 'Configured' : 'Missing'}</td>
                        <td>{canteen.qrConfigured ? 'Configured' : 'Missing'}</td>
                        <td className="muted">
                          {canteen.updatedAt ? formatDateTime(canteen.updatedAt) : '—'}
                        </td>
                        <td>
                          <Link to={`/payments/${canteen.id}`} className="btn btn-secondary btn-sm">
                            Configure
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </>
  );
}

/** Reuses the canteen payment form. Official details are entered here, never invented. */
export function PaymentCanteenPage() {
  const { canteenId = '' } = useParams();
  const api = useAdminApi();
  const canteen = useResource(() => api.canteen(canteenId), [api, canteenId]);

  return (
    <>
      <p className="breadcrumb">
        <Link to="/payments">Payments & QR</Link>
      </p>
      <div className="page-header">
        <div>
          <h1>{canteen.data?.name ?? 'Payment configuration'}</h1>
          <p>Official UPI and QR apply only to this canteen.</p>
        </div>
      </div>
      {canteen.error && !canteen.data ? (
        <ErrorState error={canteen.error} onRetry={() => void canteen.reload()} />
      ) : (
        <PaymentSection canteenId={canteenId} />
      )}
    </>
  );
}
