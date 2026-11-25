import {
  ChangePasswordForm,
  ErrorState,
  SkeletonRows,
  useAuth,
  useResource,
} from '@serve/web-shared';
import { useAdminApi } from '../useAdminApi';

/**
 * Display values already used by the product (nothing here is an environment
 * secret), and the signed-in admin's password.
 */
export function SettingsPage() {
  const api = useAdminApi();
  const { changePassword } = useAuth();
  const settings = useResource(() => api.settings(), [api]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>
            University details shown on receipts (not editable from this screen), and your password.
          </p>
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
      <section className="section" aria-label="Password">
        <div className="section-header">
          <h2>Password</h2>
        </div>
        <ChangePasswordForm onChange={changePassword} />
      </section>
    </>
  );
}
