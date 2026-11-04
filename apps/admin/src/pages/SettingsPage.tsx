import { ErrorState, SkeletonRows, useResource } from '@serve/web-shared';
import { useAdminApi } from '../useAdminApi';

/** Display values already used by the product. Nothing here is an environment secret. */
export function SettingsPage() {
  const api = useAdminApi();
  const settings = useResource(() => api.settings(), [api]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>University details shown on receipts. These are not editable from this screen.</p>
        </div>
      </div>
      {settings.loading && !settings.data ? (
        <SkeletonRows rows={3} />
      ) : settings.error && !settings.data ? (
        <ErrorState error={settings.error} onRetry={() => void settings.reload()} />
      ) : settings.data ? (
        <section className="section" aria-label="University">
          <ul className="plain-list">
            <li>
              <span className="summary-label">University</span>
              <strong>{settings.data.universityName}</strong>
            </li>
            <li>
              <span className="summary-label">Timezone</span>
              <strong>{settings.data.timezone}</strong>
            </li>
            <li>
              <span className="summary-label">Contact</span>
              <strong>{settings.data.contact ?? 'Not configured'}</strong>
            </li>
          </ul>
        </section>
      ) : null}
    </>
  );
}
