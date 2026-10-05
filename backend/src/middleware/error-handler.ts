import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { AppError, NotFoundError } from '../lib/errors.js';

interface ErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

/** Body-parser errors carry an HTTP status and a `type`. */
interface HttpParserError extends Error {
  status?: number;
  type?: string;
}

const isParserError = (err: unknown): err is HttpParserError =>
  err instanceof Error && typeof (err as HttpParserError).type === 'string';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route ${req.method} ${req.path} not found`, 'ROUTE_NOT_FOUND'));
};

/**
 * Central error handler — the single place errors become HTTP responses.
 * Unknown errors are logged in full but returned as a generic 500 so internal
 * details never leak to clients.
 */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  const requestId = typeof req.id === 'string' ? req.id : undefined;
  let status = 500;
  let body: ErrorBody['error'] = {
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong. Please try again.',
  };

  if (err instanceof AppError) {
    status = err.statusCode;
    body = { code: err.code, message: err.message };
    if (err.details !== undefined) body.details = err.details;
  } else if (err instanceof ZodError) {
    status = 422;
    body = {
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    };
  } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    // Unique-constraint race not caught by a service-level check.
    status = 409;
    body = { code: 'CONFLICT', message: 'This conflicts with an existing record.' };
  } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
    status = 404;
    body = { code: 'NOT_FOUND', message: 'Resource not found' };
  } else if (isParserError(err) && err.type === 'entity.parse.failed') {
    status = 400;
    body = { code: 'INVALID_JSON', message: 'Request body is not valid JSON' };
  } else if (isParserError(err) && err.type === 'entity.too.large') {
    status = 413;
    body = { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' };
  } else if (isParserError(err) && typeof err.status === 'number' && err.status < 500) {
    status = err.status;
    body = { code: 'BAD_REQUEST', message: 'Malformed request' };
  }

  if (status >= 500) {
    req.log.error({ err }, 'Unhandled error');
  }

  if (requestId) body.requestId = requestId;
  res.status(status).json({ error: body } satisfies ErrorBody);
};
