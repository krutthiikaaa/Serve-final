import { useMemo } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import {
  AuthLayout,
  AuthProvider,
  Button,
  ErrorState,
  NotificationsProvider,
  RealtimeProvider,
  SignInForm,
  Spinner,
  ToastProvider,
  initFirebaseAuth,
  isConnectivityError,
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

export function App() {
  const auth = useMemo(() => initFirebaseAuth(config.firebase), []);
  return (
    <ToastProvider>
      <AuthProvider auth={auth} baseUrl={config.apiUrl}>
        <BrowserRouter>
          <Gate />
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  );
}

/**
 * Admin access is decided by the backend account (`/api/auth/me`), never by
 * the token or the URL. Admin accounts are provisioned by the bootstrap script;
 * there is no self-registration here.
 */
export function Gate() {
  const { status, me, error, api, getToken, refreshMe, signIn, signOut } = useAuth();
  const client = useMemo(() => adminApi(api), [api]);

  if (status === 'initializing' || status === 'loadingAccount')
    return <Spinner label="Loading your account" />;

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
    return (
      <AuthLayout subtitle="Admin portal">
        <section className="section">
          <div className="section-body">
            <SignInForm onSubmit={signIn} />
          </div>
        </section>
        <p className="auth-switch">Admin accounts are created by the SERVE operations team.</p>
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

  return (
    <AdminApiContext.Provider value={client}>
      <RealtimeProvider url={config.apiUrl} getToken={getToken} enabled>
        <NotificationsProvider api={api}>
          <Routes>
            <Route element={<AdminLayout me={me} />}>
              <Route index element={<DashboardPage />} />
              <Route path="canteens" element={<CanteensPage />} />
              <Route path="canteens/:id" element={<CanteenDetailPage />} />
              <Route path="change-requests" element={<ChangeRequestsPage />} />
              <Route path="staff" element={<StaffPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </NotificationsProvider>
      </RealtimeProvider>
    </AdminApiContext.Provider>
  );
}
