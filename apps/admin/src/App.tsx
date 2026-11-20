import { useMemo } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import {
  AuthLayout,
  AuthProvider,
  Button,
  ErrorState,
  NotificationsProvider,
  GoogleSignIn,
  RealtimeProvider,
  Spinner,
  ToastProvider,
  isConnectivityError,
  ssoLog,
  useAuth,
} from '@serve/web-shared';
import { config } from './config';
import { adminApi } from './api/admin';
import { AdminApiContext } from './useAdminApi';
import { AdminLayout } from './components/AdminLayout';
import { DashboardPage } from './pages/DashboardPage';
import { CanteensPage } from './pages/CanteensPage';
import { CanteenDetailPage } from './pages/CanteenDetailPage';
import { ChangeRequestsPage } from './pages/ChangeRequestsPage';
import { StaffPage } from './pages/StaffPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { MenuPage } from './pages/MenuPage';
import { PaymentsPage, PaymentCanteenPage } from './pages/PaymentsPage';
import { ReportsPage } from './pages/ReportsPage';
import { ActivityPage } from './pages/ActivityPage';
import { SettingsPage } from './pages/SettingsPage';

/** `/` in development, `/admin` when served under /admin/ (Vite `base`). */
const routerBasename = import.meta.env.BASE_URL.replace(/\/$/, '');

export function App() {
  return (
    <ToastProvider>
      <AuthProvider baseUrl={config.apiUrl} appUrl={config.appUrl}>
        <BrowserRouter basename={routerBasename}>
          <Gate />
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  );
}

/**
 * Admin access is decided by the backend account (`/api/auth/me`), never by
 * the Google sign-in or the URL. Admin accounts are provisioned by email with
 * the bootstrap script; there is no self-registration here.
 */
export function Gate() {
  return (
    <Routes>
      {/* Old SSO handoff links: the shared SERVE session already signs the user in. */}
      <Route path="/sso/callback" element={<Navigate to="/" replace />} />
      <Route path="*" element={<AccountGate />} />
    </Routes>
  );
}

function AccountGate() {
  const { status, me, user, error, api, refreshMe, signInWithGoogle, signInError, signOut } =
    useAuth();
  const client = useMemo(() => adminApi(api), [api]);

  if (
    status === 'initializing' ||
    status === 'loadingAccount' ||
    (user && !me && status !== 'error')
  ) {
    ssoLog('guard', {
      audience: 'ADMIN',
      status,
      hasUser: Boolean(user),
      hasMe: false,
      destination: 'loading',
    });
    return <Spinner label="Loading your account" />;
  }

  if (status === 'error') {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <ErrorState error={error} onRetry={() => void refreshMe()} />
          {!isConnectivityError(error) ? (
            <Button variant="ghost" onClick={() => void signOut()}>
              Sign out
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (status === 'signedOut' || !me) {
    ssoLog('guard', {
      audience: 'ADMIN',
      status,
      hasUser: Boolean(user),
      hasMe: Boolean(me),
      destination: 'login',
    });
    return (
      <AuthLayout subtitle="Admin portal">
        <section className="section">
          <div className="section-body">
            <GoogleSignIn onSignIn={signInWithGoogle} error={signInError} />
          </div>
        </section>
        <p className="auth-switch">
          Admin access is granted by the SERVE operations team to SRM Google accounts.
        </p>
      </AuthLayout>
    );
  }

  if (me.role !== 'ADMIN' || !me.isActive) {
    return (
      <AuthLayout subtitle={me.role === 'ADMIN' ? 'Admin access disabled' : 'Not an admin account'}>
        <section className="section">
          <div className="section-body status-panel">
            <p>
              {me.role === 'ADMIN'
                ? 'This admin account has been disabled. Contact the SERVE operations team.'
                : me.role === 'STAFF'
                  ? 'You are signed in with a staff account. Use the staff dashboard instead.'
                  : me.role === 'STUDENT'
                    ? 'You are signed in with a student account. Use the SERVE mobile app to order.'
                    : 'This account is not registered as a SERVE admin.'}
            </p>
            <Button variant="secondary" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </section>
      </AuthLayout>
    );
  }

  ssoLog('guard', {
    audience: 'ADMIN',
    status,
    hasUser: Boolean(user),
    hasMe: true,
    role: me.role,
    destination: 'app',
  });
  return (
    <AdminApiContext.Provider value={client}>
      <RealtimeProvider url={config.apiUrl} enabled onSessionEnded={() => void refreshMe()}>
        <NotificationsProvider api={api}>
          <Routes>
            <Route element={<AdminLayout me={me} />}>
              <Route index element={<DashboardPage />} />
              <Route path="canteens" element={<CanteensPage />} />
              <Route path="canteens/:id" element={<CanteenDetailPage />} />
              <Route path="menu" element={<MenuPage />} />
              <Route path="change-requests" element={<ChangeRequestsPage />} />
              <Route path="staff" element={<StaffPage />} />
              <Route path="payments" element={<PaymentsPage />} />
              <Route path="payments/:canteenId" element={<PaymentCanteenPage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="activity" element={<ActivityPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </NotificationsProvider>
      </RealtimeProvider>
    </AdminApiContext.Provider>
  );
}
