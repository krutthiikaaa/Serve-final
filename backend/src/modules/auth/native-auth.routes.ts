import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import express, { Router, type Response } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { UnauthorizedError } from '../../lib/errors.js';
import { authBaseUrl } from '../../lib/auth.js';
import { sensitiveLimiter } from '../../middleware/rate-limit.js';
import { parse } from '../../http/validation.js';

/**
 * Google sign-in for the native (Android / iOS) student app.
 *
 * The app opens the system browser (not a WebView) and gets back a one-time
 * code on its own URL scheme; it then exchanges the code for a session token
 * it sends as `Authorization: Bearer`. Same Better Auth flow and SRM rules as
 * the web apps (RFC 8252 + PKCE):
 *
 *   1. app → GET /api/native-auth/start?code_challenge=<S256 of a secret verifier>
 *      browser → Google → /api/auth/callback/google (Better Auth, SRM gate)
 *   2.        → GET /api/native-auth/finish → app.serve.student://auth?code=…
 *   3. app → POST /api/native-auth/exchange { code, code_verifier } → { token }
 *
 * The code is single-use, expires after 2 minutes and is useless without the
 * verifier that never left the app, so an app that intercepts the redirect
 * cannot redeem it.
 */
export const NATIVE_REDIRECT_URI = 'app.serve.student://auth';
const CODE_TTL_MS = 2 * 60_000;
const CHALLENGE_COOKIE = 'serve.native_challenge';
const IDENTIFIER_PREFIX = 'serve-native-sign-in:';

const b64url = /^[A-Za-z0-9_-]{43}$/;
const startQuery = z.object({
  code_challenge: z.string().regex(b64url, { error: 'code_challenge must be a base64url SHA-256' }),
  code_challenge_method: z.literal('S256').default('S256'),
});
const exchangeBody = z.strictObject({
  code: z.string().min(20).max(128),
  code_verifier: z.string().min(43).max(128),
});

const sha256 = (value: string) => createHash('sha256').update(value).digest('base64url');

function appRedirect(res: Response, params: Record<string, string>) {
  const url = new URL(NATIVE_REDIRECT_URI);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  res.redirect(302, url.toString());
}

function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function createNativeAuthRouter(ctx: AppContext): Router {
  const router = Router();
  const base = authBaseUrl(ctx.env);
  const secure = ctx.env.NODE_ENV === 'production';
  const limiter = sensitiveLimiter(ctx.env);

  router.get('/start', limiter, async (req, res) => {
    const { code_challenge: challenge } = parse(startQuery, req.query);
    // Better Auth starts Google sign-in; its state cookie and our challenge
    // cookie both live in this browser until Google sends it back.
    const response = await ctx.auth.api.signInSocial({
      body: {
        provider: 'google',
        callbackURL: `${base}/api/native-auth/finish`,
        errorCallbackURL: `${base}/api/native-auth/finish`,
      },
      headers: new Headers({ origin: base }),
      asResponse: true,
    });
    const { url } = (await response.json()) as { url?: string };
    if (!response.ok || !url) {
      return appRedirect(res, { error: 'GOOGLE_SIGN_IN_UNAVAILABLE' });
    }
    for (const cookie of response.headers.getSetCookie()) res.append('Set-Cookie', cookie);
    res.cookie(CHALLENGE_COOKIE, challenge, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: 10 * 60_000,
      path: '/api/native-auth',
    });
    res.redirect(302, url);
  });

  router.get('/finish', async (req, res) => {
    const challenge = readCookie(req.headers.cookie, CHALLENGE_COOKIE);
    res.clearCookie(CHALLENGE_COOKIE, { path: '/api/native-auth' });
    const error = typeof req.query.error === 'string' ? req.query.error : null;
    if (error) return appRedirect(res, { error: error.slice(0, 64) });
    const identity = await ctx.sessions.verify(req.headers);
    if (!identity || !challenge || !b64url.test(challenge)) {
      return appRedirect(res, { error: 'SIGN_IN_FAILED' });
    }
    const session = await ctx.prisma.authSession.findUnique({
      where: { id: identity.sessionId },
      select: { token: true },
    });
    if (!session) return appRedirect(res, { error: 'SIGN_IN_FAILED' });
    const code = randomBytes(32).toString('base64url');
    await ctx.prisma.authVerification.create({
      data: {
        id: randomBytes(16).toString('hex'),
        identifier: IDENTIFIER_PREFIX + sha256(code),
        value: JSON.stringify({ token: session.token, challenge }),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });
    appRedirect(res, { code });
  });

  router.post('/exchange', express.json({ limit: '2kb' }), limiter, async (req, res) => {
    const { code, code_verifier: verifier } = parse(exchangeBody, req.body);
    const identifier = IDENTIFIER_PREFIX + sha256(code);
    const row = await ctx.prisma.authVerification.findFirst({ where: { identifier } });
    // Single use: only the request that deletes the row may redeem it.
    const consumed = row
      ? await ctx.prisma.authVerification.deleteMany({ where: { id: row.id } })
      : { count: 0 };
    const invalid = () =>
      new UnauthorizedError('This sign-in link is invalid or has expired.', 'NATIVE_CODE_INVALID');
    if (!row || consumed.count !== 1 || row.expiresAt.getTime() <= Date.now()) throw invalid();
    const { token, challenge } = JSON.parse(row.value) as { token: string; challenge: string };
    const expected = Buffer.from(challenge);
    const actual = Buffer.from(sha256(verifier));
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw invalid();
    // The session must still be valid (not signed out or expired since).
    const identity = await ctx.sessions.verify(new Headers({ authorization: `Bearer ${token}` }));
    if (!identity) throw invalid();
    res.json({ data: { token, expiresAt: identity.expiresAt.toISOString() } });
  });

  return router;
}
