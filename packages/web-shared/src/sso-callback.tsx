import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { errorMessage, type ApiClient } from './api';
import { useAuth } from './auth';
import { AuthLayout } from './auth-screens';
import { ssoLog } from './sso-log';
import { Button, FormError, Spinner } from './ui/components';

/**
 * React Strict Mode remounts the callback page, which would otherwise POST the
 * one-time code twice. Share the in-flight exchange so the second mount reuses
 * the Custom Token instead of racing a 401.
 */
const inFlightExchanges = new Map<string, Promise<string>>();
const redeemedCodes = new Set<string>();

function exchangeAuthorizationCode(
  api: ApiClient,
  code: string,
  audience: 'STAFF' | 'ADMIN',
): Promise<string> {
  const key = `${audience}:${code}`;
  const existing = inFlightExchanges.get(key);
  if (existing) return existing;
  ssoLog('exchange request started', { audience });
  const pending = api
    .data<{ customToken: string }>('POST', '/auth/sso/exchange', {
      body: { code, audience },
      anonymous: true,
    })
    .then((data) => {
      ssoLog('exchange succeeded', { audience, customToken: Boolean(data.customToken) });
      return data.customToken;
    })
    .catch((err) => {
      ssoLog('exchange failed', {
        audience,
        status: err instanceof Object && 'status' in err ? (err as { status: unknown }).status : undefined,
      });
      throw err;
    });
  inFlightExchanges.set(key, pending);
  return pending;
}

/**
 * Dashboard SSO landing page. Exchanges a one-time authorization code for a
 * Firebase Custom Token, then establishes this origin's own Auth session.
 */
export function SsoCallbackPage({
  audience,
  studentAppUrl,
}: {
  audience: 'STAFF' | 'ADMIN';
  studentAppUrl: string;
}) {
  const { api, signInWithCustomToken, waitForAuthReady, status, user } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ssoLog('callback mounted', { audience, hasCode: (params.get('code')?.trim().length ?? 0) >= 16 });
  }, [audience, params]);

  useEffect(() => {
    let cancelled = false;
    const code = params.get('code')?.trim() ?? '';
    if (code.length < 16) {
      setError('This sign-in link is missing or incomplete. Return to SERVE and sign in again.');
      return;
    }
    void (async () => {
      try {
        await waitForAuthReady();
        if (cancelled) return;
        const customToken = await exchangeAuthorizationCode(api, code, audience);
        if (cancelled) return;
        ssoLog('firebase sign-in started', { audience });
        await signInWithCustomToken(customToken);
        redeemedCodes.add(`${audience}:${code}`);
        ssoLog('firebase sign-in succeeded', { audience, currentUser: true });
      } catch (err) {
        ssoLog('firebase sign-in failed', { audience, currentUser: false });
        if (!cancelled && !redeemedCodes.has(`${audience}:${code}`)) {
          setError(errorMessage(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, audience, params, signInWithCustomToken, waitForAuthReady]);

  useEffect(() => {
    if (error) return;
    if (status !== 'ready' && !(status === 'error' && user)) return;
    ssoLog('callback redirect', { audience, destination: '/', status });
    navigate('/', { replace: true });
  }, [audience, error, navigate, status, user]);

  if (error) {
    return (
      <AuthLayout subtitle="Sign-in could not be completed">
        <section className="section">
          <div className="section-body">
            <FormError error={error} />
            <p className="muted small">
              You can return to SERVE and sign in again. This dashboard did not keep the one-time
              sign-in code.
            </p>
            <Button variant="secondary" onClick={() => window.location.assign(studentAppUrl)}>
              Return to SERVE
            </Button>
          </div>
        </section>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout subtitle="Signing you in">
      <Spinner label="Completing sign-in" />
    </AuthLayout>
  );
}
