import type { Logger } from 'pino';

/**
 * Smallest additive audit trail: structured pino records with `audit: true`.
 * No new table. Secrets and credential-like fields are stripped before write.
 */
const SENSITIVE_KEYS = new Set([
  'upiVpa',
  'qrStorageKey',
  'password',
  'secret',
  'token',
  'ifsc',
  'accountNumber',
  'bankAccount',
  'privateKey',
  'signature',
]);

export interface AuditActor {
  role: string;
  id: string;
}

export interface AuditTarget {
  type: string;
  id: string;
}

export interface AuditEvent {
  actor: AuditActor;
  action: string;
  target: AuditTarget;
  before?: unknown;
  after?: unknown;
}

function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => {
        if (SENSITIVE_KEYS.has(key)) {
          return [`${key}Set`, nested != null && nested !== ''];
        }
        return [key, sanitize(nested)];
      }),
    );
  }
  return value;
}

export function writeAudit(logger: Logger, event: AuditEvent): void {
  logger.info({
    audit: true,
    actor: event.actor,
    action: event.action,
    target: event.target,
    before: sanitize(event.before ?? null),
    after: sanitize(event.after ?? null),
  });
}
