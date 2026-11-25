import type { ChangeRequest, MeStaff } from '@serve/contracts';
import {
  CanteenTypeBadge,
  ChangePasswordForm,
  EmptyState,
  ErrorState,
  IconInbox,
  SkeletonRows,
  Tag,
  formatDateTime,
  useAuth,
  useResource,
  useServerEvent,
} from '@serve/web-shared';
import { useStaffApi } from '../useStaffApi';

/** Profile, the account's dedicated canteen, password and past access requests. */
export function AccountPage({ me }: { me: MeStaff }) {
  const api = useStaffApi();
  const { refreshMe, changePassword } = useAuth();
  const history = useResource(() => api.changeRequests(), [api, me.pendingChangeRequest?.id]);

  useServerEvent('change_request.updated', () => {
    void history.reload();
    void refreshMe();
  });

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Account</h1>
          <p>Your staff profile and canteen assignment.</p>
        </div>
      </div>

      <section className="section">
        <div className="section-header">
          <h2>Profile</h2>
        </div>
        <dl className="section-body detail-grid">
          <dt>Name</dt>
          <dd>{me.name}</dd>
          <dt>Email</dt>
          <dd>{me.email}</dd>
          <dt>Status</dt>
          <dd>
            <Tag tone="success">Approved</Tag>
          </dd>
          <dt>Canteen</dt>
          <dd className="inline-meta">
            {me.canteen?.name}
            {me.canteen ? <CanteenTypeBadge type={me.canteen.type} /> : null}
          </dd>
        </dl>
        <p className="section-body muted small">
          This login is dedicated to {me.canteen?.name}. Each canteen, Day or Night, has its own
          staff account, and only an admin can change which canteen an account belongs to.
        </p>
      </section>

      <section className="section" aria-label="Password">
        <div className="section-header">
          <h2>Password</h2>
        </div>
        <ChangePasswordForm onChange={changePassword} />
      </section>

      <section className="section">
        <div className="section-header">
          <h2>Request history</h2>
        </div>
        {history.loading && !history.data ? (
          <SkeletonRows rows={2} />
        ) : history.error && !history.data ? (
          <ErrorState error={history.error} onRetry={() => void history.reload()} />
        ) : history.data && history.data.data.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Requested</th>
                  <th>Canteen</th>
                  <th>Status</th>
                  <th>Admin note</th>
                </tr>
              </thead>
              <tbody>
                {history.data.data.map((request) => (
                  <tr key={request.id}>
                    <td className="muted">{formatDateTime(request.createdAt)}</td>
                    <td>
                      {request.fromCanteen ? `${request.fromCanteen.name} → ` : ''}
                      {request.requestedCanteen.name}
                    </td>
                    <td>
                      <RequestStatusTag status={request.status} />
                    </td>
                    <td className="muted">{request.reviewNotes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<IconInbox />} title="No requests yet" />
        )}
      </section>
    </>
  );
}

export function RequestStatusTag({ status }: { status: ChangeRequest['status'] }) {
  if (status === 'APPROVED') return <Tag tone="success">Approved</Tag>;
  if (status === 'REJECTED') return <Tag tone="danger">Rejected</Tag>;
  return <Tag tone="warning">Pending</Tag>;
}
