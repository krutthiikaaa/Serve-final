# SERVE — Database

PostgreSQL 16 through **Prisma 7**: the `prisma-client` generator with the
`partialIndexes` preview feature, and the `@prisma/adapter-pg` driver adapter.
PostgreSQL is the source of truth for every account, role, assignment, menu
item, price, order, payment and notification.

## Files

| File | Purpose |
|---|---|
| `backend/prisma/schema.prisma` | Domain model |
| `backend/prisma/migrations/20261005184013_init_domain_schema/` | Initial migration: Prisma DDL plus hand-written constraints (see below) |
| `backend/prisma.config.ts` | Prisma CLI config: schema and migrations paths, `DATABASE_URL`, seed command |
| `backend/src/db/seed.ts` / `backend/prisma/seed.ts` | Idempotent development seed |
| `backend/scripts/seed-dev-users.ts` | Emulator-only demo accounts |
| `backend/scripts/db-setup-local.sh` | Creates the local role and the `serve_dev` / `serve_test` databases |

## Entity relationships

```
Canteen 1─* Hostel 1─* Student 1─* Order *─1 Canteen
   │                                   │
   ├─* Staff (canteenId, nullable)     ├─* OrderItem  (immutable snapshot)
   ├─* MenuCategory 1─* MenuItem       ├─1 Payment
   └─* CanteenChangeRequest            └─* Notification
          (requested / from canteen)

Staff 1─* CanteenChangeRequest *─1 Admin (reviewer)
Notification → exactly one of Student | Staff | Admin  (+ optional Order)
ProcessedPaymentEvent (provider, eventId) — replay protection
```

| Model | Key fields | Relationships |
|---|---|---|
| **Canteen** | `name` unique, `slug` unique, `location`, `openingHours`, `isActive`, `isAcceptingOrders` | hostels, staff, categories, items, orders |
| **Hostel** | `name` unique, `canteenId`, `isActive` | belongs to its default Canteen (delete restricted) |
| **Student** | `firebaseUid` unique, `email` unique, `name`, `hostelId`, `isActive` | belongs to a Hostel |
| **Staff** | `firebaseUid` unique, `email` unique, `status` (PENDING / APPROVED / REJECTED / DEACTIVATED), `canteenId?` | assigned Canteen |
| **Admin** | `firebaseUid` unique, `email` unique, `isActive` | reviews change requests |
| **CanteenChangeRequest** | `staffId`, `requestedCanteenId`, `fromCanteenId?`, `status`, `notes`, `reviewNotes`, `reviewedByAdminId?`, `reviewedAt?` | Staff, two Canteens, Admin |
| **MenuCategory** | `canteenId`, `name`, `sortOrder`, `isActive` | belongs to a Canteen |
| **MenuItem** | `canteenId`, `categoryId`, `name`, `description`, `pricePaise`, `imageUrl`, `isAvailable`, `isActive` | Canteen, plus a Category in the **same** canteen |
| **Order** | `orderNumber` unique, `studentId`, `canteenId`, `status`, `totalPaise`, `idempotencyKey`, `requestHash`, status timestamps, `cancelReason` | Student, Canteen, items, payment |
| **OrderItem** | `orderId`, `menuItemId?`, `itemName`, `unitPricePaise`, `quantity`, `lineTotalPaise` | Order (cascade), MenuItem (set null) |
| **Payment** | `orderId` unique, `provider` (MOCK / RAZORPAY), `status` (PENDING / SUCCESS / FAILED / REFUNDED), `amountPaise`, `currency`, `providerOrderId` unique, `providerPaymentId` unique, `signature`, `failureReason`, `paidAt`, `refundedAt` | one per Order |
| **ProcessedPaymentEvent** | `provider`, `eventId`, `processedAt` | unique (`provider`, `eventId`) |
| **Notification** | `studentId?`, `staffId?`, `adminId?`, `orderId?`, `type`, `title`, `message`, `data`, `readAt` | exactly one recipient |

All ids are server-generated UUIDs. Every mutable table has `createdAt` and
`updatedAt`.

## Constraints

Prisma-managed constraints:
- every foreign key
- unique: canteen name and slug; hostel name; account `firebaseUid` and `email`; (`canteenId`, `name`) for categories and items; `orderNumber`; (`studentId`, `idempotencyKey`); `Payment.orderId`; provider ids; (`provider`, `eventId`)
- composite FK `MenuItem(categoryId, canteenId) → MenuCategory(id, canteenId)`, so an item's category always belongs to the same canteen
- partial unique index `CanteenChangeRequest_one_pending_per_staff` on `(staffId) WHERE status = 'PENDING'`

Added in the migration SQL:

| Constraint | Rule |
|---|---|
| `*_email_normalized_check` | Emails are stored lower-case and trimmed |
| `Staff_approved_requires_canteen_check` | `APPROVED` ⇒ `canteenId IS NOT NULL` |
| `CanteenChangeRequest_distinct_canteens_check` | from ≠ requested |
| `CanteenChangeRequest_review_consistency_check` | `PENDING` ⇔ `reviewedAt IS NULL` |
| `MenuItem_price_positive_check`, `Order_total_positive_check`, `OrderItem_unit_price_positive_check`, `Payment_amount_positive_check` | > 0 |
| `OrderItem_quantity_range_check` | 1 ≤ quantity ≤ 20 |
| `OrderItem_line_total_check` | `lineTotalPaise = unitPricePaise × quantity` |
| `Order_idempotency_key_format_check` | `^[A-Za-z0-9_-]{8,128}$` |
| `Notification_single_recipient_check` | `num_nonnulls(studentId, staffId, adminId) = 1` |
| trigger `OrderItem_immutable` | `UPDATE` on `OrderItem` raises an error |
| sequence `order_number_seq` | starts at 1001; `orderNumber` defaults to `'SV' \|\| nextval(...)` |

`prisma migrate diff` reports **no drift**: Prisma does not model CHECK
constraints, triggers or this sequence, and leaves them in place.

## Indexes

| Table | Indexes |
|---|---|
| Hostel | `canteenId` |
| Student | `firebaseUid` (unique), `email` (unique), `hostelId` |
| Staff | `firebaseUid` (unique), `email` (unique), `canteenId`, `status` |
| CanteenChangeRequest | (`staffId`, `createdAt`), (`status`, `createdAt`), partial unique pending |
| MenuCategory | `canteenId`, (`canteenId`, `name`) unique, (`id`, `canteenId`) unique |
| MenuItem | `canteenId`, `categoryId`, (`canteenId`, `isAvailable`), (`canteenId`, `name`) unique |
| Order | (`studentId`, `createdAt`), (`canteenId`, `status`, `createdAt`), `status`, `createdAt`, `idempotencyKey`, (`studentId`, `idempotencyKey`) unique |
| OrderItem | `orderId`, `menuItemId` |
| Payment | `orderId` (unique), `status`, provider ids (unique) |
| Notification | (`studentId`, `createdAt`), (`staffId`, `createdAt`), (`adminId`, `createdAt`), `createdAt` |

Lists use keyset pagination on (`createdAt` desc, `id` desc), served by these
indexes.

## Money

All amounts are **integer paise** (`Int`). There are no floats anywhere. ₹120
is stored as `12000`. The order total is the sum of line totals computed on
the server from current `MenuItem.pricePaise`. `Payment.amountPaise` is written
in the same transaction and must equal the captured amount reported by the
provider.

## Order snapshots

`OrderItem` stores `itemName`, `unitPricePaise`, `quantity` and
`lineTotalPaise` at order time. Renaming, repricing, disabling or deleting a
menu item never changes historical orders. The `OrderItem_immutable` trigger
blocks updates at the database level.

## Authorization relationships

- A Firebase UID maps to exactly one of Student, Staff or Admin. Registration refuses UIDs that already have an account.
- Staff may operate only `Staff.canteenId`, and only while `status = APPROVED`. The backend reads this from the database on every request and every socket handshake.
- Students order from any canteen with `isActive AND isAcceptingOrders`. The default canteen is `Student → Hostel → Canteen`.

## Canteen / hostel mapping (seed)

| Hostel | Night canteen |
|---|---|
| Krishna, Godavari | Krishna & Godavari Night Canteen |
| Yamuna, Narmada | Yamuna & Narmada Night Canteen |
| New Hostel | New Hostel Night Canteen |
| Vedavathi | Vedavathi Night Canteen |
| Ganga A, Ganga B | Ganga A & Ganga B Night Canteen |

Admins manage hostels through `/api/admin/hostels`, so new towers need no
code change.

## Seed data

`npm run db:seed --workspace backend` (or `npx prisma db seed`):
- the 5 canteens and 8 hostel mappings
- the menu per canteen: 6 categories and 29 items, from the project brief (Sandwiches, Desi Bite Bites, Omelettes, Juices, Dosas, Hot Beverages)
- `imageUrl` is `null`; clients render category placeholders until real images are set

Every row is upserted by its natural key with an empty `update`. Re-running
never duplicates rows and never overwrites changes made through the app. The
seed refuses `NODE_ENV=production`.

## Migrations and safety

```bash
npm run prisma:migrate:status --workspace backend
npm run prisma:migrate:deploy --workspace backend          # apply (CI / production)
npx prisma migrate dev --create-only --name <change>       # new migration, from backend/; review the SQL first
```

- Every schema change is a reviewed migration. Never use `db push` or `migrate reset` on shared or production data.
- The test suite recreates **only** a database whose name ends in `_test` (`serve_test`): it drops the `public` schema and runs `migrate deploy`. Every test run therefore proves the migrations apply cleanly to an empty database.
