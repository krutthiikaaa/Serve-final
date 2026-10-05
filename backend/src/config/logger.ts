import { pino, type DestinationStream, type Logger } from 'pino';
import type { Env } from './env.js';

/**
 * Paths redacted from every log line. Covers auth headers, cookies, tokens,
 * payment signatures and credential-like fields wherever they appear.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["idempotency-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.idToken',
  '*.accessToken',
  '*.refreshToken',
  '*.privateKey',
  '*.secret',
  '*.signature',
  '*.authorization',
  'DATABASE_URL',
  'FIREBASE_PRIVATE_KEY',
  'PAYMENT_SECRET',
];

export function createLogger(
  env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>,
  destination?: DestinationStream,
): Logger {
  const options = {
    level: env.LOG_LEVEL,
    base: { service: 'serve-backend', env: env.NODE_ENV },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (destination) return pino(options, destination);

  // Human-readable output in development; structured JSON everywhere else.
  if (env.NODE_ENV === 'development') {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss' },
      },
    });
  }
  return pino(options);
}
