# SERVE — REST API

Base URL: `http://localhost:5001/api` in development (configurable; there is
no production default). All responses are JSON.

_Status: Phase 1. Only the health endpoints exist so far. Feature endpoints
arrive in Phase 4 and will be documented here as they're implemented._

## Conventions

| Topic | Rule |
|---|---|
| Auth | `Authorization: Bearer <Firebase ID token>` _(Phase 3)_ |
| Request id | Every response has `X-Request-Id`. A well-formed incoming `X-Request-Id` (8–64 chars, `[A-Za-z0-9-]`) is propagated. |
| Idempotency | `Idempotency-Key` header on order creation _(Phase 9)_ |
| Body limit | 100 kB JSON |
| Rate limit | `RATE_LIMIT_MAX` requests per `RATE_LIMIT_WINDOW_MS` per client IP on `/api/*` (health excluded). Returns `RateLimit` / `RateLimit-Policy` headers. |
| CORS | Exact origins from `CORS_ORIGINS`; no cookies or credentials |

### Error format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [{ "path": "items.0.quantity", "message": "Too big" }],
    "requestId": "8a1c…"
  }
}
```

| Status | Meaning | Example codes |
|---|---|---|
| 400 | Malformed request | `INVALID_JSON`, `BAD_REQUEST` |
| 401 | Missing or invalid token | `UNAUTHORIZED` |
| 403 | Authenticated but not allowed | `FORBIDDEN` |
| 404 | Not found, or not visible to you | `NOT_FOUND`, `ROUTE_NOT_FOUND` |
| 409 | State conflict | `CANTEEN_PAUSED`, `DUPLICATE_REQUEST` |
| 413 | Body too large | `PAYLOAD_TOO_LARGE` |
| 422 | Validation or business rule | `VALIDATION_ERROR`, `ITEM_UNAVAILABLE` |
| 429 | Rate limited | `RATE_LIMITED` |
| 500 | Unexpected | `INTERNAL_ERROR` |
| 503 | Dependency down | `DATABASE_UNAVAILABLE` |

## Health

### `GET /api/health`

Liveness. Has no dependencies and is never rate limited.

```http
HTTP/1.1 200 OK
{ "status": "ok", "service": "serve-backend", "uptimeSeconds": 42, "timestamp": "2026-10-05T08:31:17.603Z" }
```

### `GET /api/health/db`

Readiness. Runs a real `SELECT 1` round-trip against PostgreSQL with a 3 s timeout.

```http
HTTP/1.1 200 OK
{ "status": "ok", "database": "postgresql", "latencyMs": 1.24, "timestamp": "…" }
```

```http
HTTP/1.1 503 Service Unavailable
{ "error": { "code": "DATABASE_UNAVAILABLE", "message": "Database is unreachable", "requestId": "…" } }
```

## Planned endpoints (Phase 4)

| Area | Endpoints |
|---|---|
| Auth | `GET /auth/me`, `POST /auth/student/register`, `POST /auth/staff/register` |
| Lookup | `GET /hostels`, `GET /canteens` |
| Student | `GET /canteens/:id/menu`, `POST /cart/quote`, `POST /orders`, `GET /orders`, `GET /orders/:id`, `GET/PATCH /notifications`, `GET /me/recommendations` |
| Payments | `POST /payments/:orderId/initiate`, `POST /payments/mock/:providerOrderId/complete`, `POST /payments/verify` |
| Staff | `/staff/dashboard`, `/staff/orders[/:id[/status]]`, `/staff/canteen/status`, `/staff/menu/categories`, `/staff/menu/items`, `/staff/change-requests` |
| Admin | `/admin/dashboard`, `/admin/canteens[/:id]`, `/admin/hostels`, `/admin/staff[/:id]`, `/admin/change-requests[/:id/approve\|reject]` |
