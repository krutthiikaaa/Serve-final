import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
/** Query parameters that carry one-time sign-in secrets (Google OAuth callback, native hand-off). */
const SECRET_QUERY = /([?&](?:code|state|token|code_verifier)=)[^&#]*/gi;

/** The request URL as logged: one-time sign-in codes are replaced. */
export function loggableUrl(url: string): string {
  return url.replace(SECRET_QUERY, '$1[REDACTED]');
}

/**
 * Structured request logging with a per-request id.
 * An incoming X-Request-Id is reused only if it is well-formed (for tracing
 * through a load balancer); otherwise a fresh UUID is generated.
 * The id is echoed back in the X-Request-Id response header.
 */
export function requestLogger(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId(req: IncomingMessage, res: ServerResponse) {
      const incoming = req.headers['x-request-id'];
      const id =
        typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    customLogLevel(_req, res, err) {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    // Keep health probes out of the logs at info level.
    autoLogging: {
      ignore: (req) => req.url?.startsWith('/api/health') === true,
    },
    serializers: {
      req(req: { id: unknown; method: string; url: string }) {
        return { id: req.id, method: req.method, url: loggableUrl(req.url) };
      },
    },
  });
}
