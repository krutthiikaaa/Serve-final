import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/config/logger.js';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { lines, stream };
}

describe('logger redaction', () => {
  it('redacts authorization headers, tokens and secrets', () => {
    const { lines, stream } = capture();
    const logger = createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'info' }, stream);

    logger.info(
      {
        req: { headers: { authorization: 'Bearer eyJhbGciOi.secret', cookie: 'sid=abc' } },
        body: { password: 'hunter2', idToken: 'tok-123', signature: 'sig-456' },
      },
      'request',
    );

    const output = lines.join('');
    expect(output).not.toContain('eyJhbGciOi');
    expect(output).not.toContain('sid=abc');
    expect(output).not.toContain('hunter2');
    expect(output).not.toContain('tok-123');
    expect(output).not.toContain('sig-456');
    expect(output).toContain('[REDACTED]');
  });
});

describe('sign-in secrets never reach the logs', () => {
  it('redacts Better Auth / Google secrets, session cookies and sign-in redirects', () => {
    const { lines, stream } = capture();
    const logger = createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'info' }, stream);
    logger.info(
      {
        BETTER_AUTH_SECRET: 'ba-secret-value',
        GOOGLE_CLIENT_SECRET: 'google-secret-value',
        provider: { clientSecret: 'nested-secret' },
        res: {
          headers: {
            'set-cookie': 'serve.session_token=abc.sig',
            location: 'app.serve.student://auth?code=one-time-code',
            'set-auth-token': 'bearer-session-token',
          },
        },
        body: { code_verifier: 'pkce-verifier' },
      },
      'sign-in',
    );
    const output = lines.join('');
    for (const secret of [
      'ba-secret-value',
      'google-secret-value',
      'nested-secret',
      'abc.sig',
      'one-time-code',
      'bearer-session-token',
      'pkce-verifier',
    ]) {
      expect(output).not.toContain(secret);
    }
  });

  it('removes one-time codes from logged request URLs', async () => {
    const { loggableUrl } = await import('../../src/middleware/request-logger.js');
    expect(loggableUrl('/api/auth/callback/google?code=4/0Ab-secret&state=xyz&scope=email')).toBe(
      '/api/auth/callback/google?code=[REDACTED]&state=[REDACTED]&scope=email',
    );
    expect(loggableUrl('/api/native-auth/start?code_challenge=abc')).toBe(
      '/api/native-auth/start?code_challenge=abc',
    );
    expect(loggableUrl('/api/orders?status=active')).toBe('/api/orders?status=active');
  });
});
