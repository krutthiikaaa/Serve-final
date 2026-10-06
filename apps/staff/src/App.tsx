import { useMemo } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import {
  AuthProvider,
  Button,
  ErrorState,
  NotificationsProvider,
  RealtimeProvider,
  Spinner,
  ToastProvider,
  initFirebaseAuth,
  isConnectivityError,
  useAuth,
} from '@serve/web-shared';
import { config } from './config';
import { staffApi } from './api/staff';
import { StaffApiContext } from './useStaffApi';
import { LoginPage } from './pages/LoginPage';
import { CreateAccountPage } from './pages/CreateAccountPage';
import { CompleteRegistrationPage } from './pages/CompleteRegistrationPage';
import { AccessStatusPage, WrongPortalPage } from './pages/AccessStatusPage';
import { StaffLayout } from './components/StaffLayout';
import { DashboardPage } from './pages/DashboardPage';
import { OrdersPage } from './pages/OrdersPage';
import { MenuPage } from './pages/MenuPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { AccountPage } from './pages/AccountPage';

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
 * Routes purely on the backend account (`/api/auth/me`). The Firebase token
 * only proves identity; nothing here trusts a client-side role.
 */
export function Gate() {
  const { status, me, error, api, getToken, refreshMe, signOut } = useAuth();
  const client = useMemo(() => staffApi(api), [api]);

  if (status === 'initializing' || status === 'loadingAccount')
    return <Spinner label="Loading your account" />;

  if (status === 'signedOut' || !me) {
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
    return (
      <Routes>
        <Route path="/create-account" element={<CreateAccountPage />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  const realtimeEnabled = me.registered && me.role === 'STAFF' && me.status !== 'DEACTIVATED';
  return (
    <StaffApiContext.Provider value={client}>
      <RealtimeProvider url={config.apiUrl} getToken={getToken} enabled={realtimeEnabled}>
        <NotificationsProvider api={api}>
          {!me.registered ? (
            <CompleteRegistrationPage />
          ) : me.role !== 'STAFF' ? (
            <WrongPortalPage role={me.role} />
          ) : me.status !== 'APPROVED' || !me.canteen ? (
            <AccessStatusPage me={me} />
          ) : (
            <Routes>
              <Route element={<StaffLayout me={me} />}>
                <Route index element={<DashboardPage />} />
                <Route path="orders" element={<OrdersPage />} />
                <Route path="menu" element={<MenuPage />} />
                <Route path="notifications" element={<NotificationsPage />} />
                <Route path="account" element={<AccountPage me={me} />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          )}
        </NotificationsProvider>
      </RealtimeProvider>
    </StaffApiContext.Provider>
  );
}
