-- Day & Night canteens: service areas, canteen types, dedicated staff accounts
-- and uploaded per-canteen payment QR codes.
--
-- NON-DESTRUCTIVE. No canteen, hostel, order, payment or menu row is deleted.
--   * Every existing canteen becomes a NIGHT canteen in its own new service
--     area (named after the canteen without the trailing "Night Canteen").
--   * Hostels move to their canteen's service area. Hostel.canteenId is kept
--     (now nullable, legacy) so history is preserved.
--   * Staff access is tightened to one canteen per account and one approved
--     account per canteen. Where existing data violates that, the newest
--     duplicate approvals are returned to PENDING (no canteen) and extra
--     assignment grants are removed. Accounts themselves are never deleted.

-- ---------------------------------------------------------------------------
-- 1. Service areas
-- ---------------------------------------------------------------------------
CREATE TABLE "ServiceArea" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceArea_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Canteen" ADD COLUMN "serviceAreaId" UUID;
ALTER TABLE "Canteen" ADD COLUMN "type" "ServicePeriod" NOT NULL DEFAULT 'NIGHT';
ALTER TABLE "Canteen" ALTER COLUMN "type" DROP DEFAULT;

UPDATE "Canteen" SET "serviceAreaId" = gen_random_uuid();

WITH base AS (
  SELECT
    "id",
    "serviceAreaId",
    "slug",
    COALESCE(
      NULLIF(btrim(regexp_replace("name", '\s*(night\s+)?canteen\s*$', '', 'i')), ''),
      "name"
    ) AS area_name
  FROM "Canteen"
),
named AS (
  SELECT
    *,
    row_number() OVER (PARTITION BY lower(area_name) ORDER BY "slug") AS dup
  FROM base
)
INSERT INTO "ServiceArea" ("id", "name", "slug", "createdAt", "updatedAt")
SELECT
  "serviceAreaId",
  CASE WHEN dup = 1 THEN area_name ELSE area_name || ' ' || dup END,
  "slug",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM named;

ALTER TABLE "Canteen" ALTER COLUMN "serviceAreaId" SET NOT NULL;

-- Every canteen keeps a service row for its own type (already NIGHT for
-- migrated canteens; inserted defensively if missing).
INSERT INTO "CanteenService" ("id", "canteenId", "period", "isEnabled", "override", "createdAt", "updatedAt")
SELECT gen_random_uuid(), c."id", c."type", true, 'FORCE_OPEN', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Canteen" c
WHERE NOT EXISTS (
  SELECT 1 FROM "CanteenService" s WHERE s."canteenId" = c."id" AND s."period" = c."type"
);

-- ---------------------------------------------------------------------------
-- 2. Hostels belong to a service area
-- ---------------------------------------------------------------------------
ALTER TABLE "Hostel" ADD COLUMN "serviceAreaId" UUID;
UPDATE "Hostel" h SET "serviceAreaId" = c."serviceAreaId" FROM "Canteen" c WHERE c."id" = h."canteenId";
ALTER TABLE "Hostel" ALTER COLUMN "serviceAreaId" SET NOT NULL;
ALTER TABLE "Hostel" ALTER COLUMN "canteenId" DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Dedicated staff accounts
-- ---------------------------------------------------------------------------
-- Keep the earliest approved account per canteen; return later duplicates to
-- PENDING without a canteen (the admin can re-assign them explicitly).
WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "canteenId" ORDER BY "createdAt", "id") AS rn
  FROM "Staff"
  WHERE "status" = 'APPROVED'
)
UPDATE "Staff" s SET "status" = 'PENDING', "canteenId" = NULL, "updatedAt" = CURRENT_TIMESTAMP
FROM ranked r WHERE r."id" = s."id" AND r.rn > 1;

-- A staff member may only hold capabilities on their own canteen.
DELETE FROM "StaffCanteenAssignment" a
USING "Staff" s
WHERE a."staffId" = s."id" AND (s."canteenId" IS NULL OR a."canteenId" <> s."canteenId");

DROP INDEX "StaffCanteenAssignment_staffId_idx";
CREATE UNIQUE INDEX "StaffCanteenAssignment_one_canteen_per_staff" ON "StaffCanteenAssignment"("staffId");
CREATE UNIQUE INDEX "Staff_one_approved_account_per_canteen" ON "Staff"("canteenId") WHERE (status = 'APPROVED');

-- ---------------------------------------------------------------------------
-- 4. Per-canteen QR uploads (history kept; one active per canteen)
-- ---------------------------------------------------------------------------
CREATE TABLE "CanteenQrCode" (
    "id" UUID NOT NULL,
    "canteenId" UUID NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "uploadedByAdminId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivatedAt" TIMESTAMP(3),

    CONSTRAINT "CanteenQrCode_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CanteenQrCode" ADD CONSTRAINT "CanteenQrCode_content_type_check"
  CHECK ("contentType" IN ('image/png', 'image/jpeg', 'image/webp'));
ALTER TABLE "CanteenQrCode" ADD CONSTRAINT "CanteenQrCode_size_check"
  CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 2097152 AND octet_length("data") = "sizeBytes");
ALTER TABLE "CanteenQrCode" ADD CONSTRAINT "CanteenQrCode_active_consistency_check"
  CHECK ("isActive" = ("deactivatedAt" IS NULL));

-- ---------------------------------------------------------------------------
-- 5. Indexes and foreign keys
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "ServiceArea_name_key" ON "ServiceArea"("name");
CREATE UNIQUE INDEX "ServiceArea_slug_key" ON "ServiceArea"("slug");
CREATE INDEX "CanteenQrCode_canteenId_createdAt_idx" ON "CanteenQrCode"("canteenId", "createdAt");
CREATE UNIQUE INDEX "CanteenQrCode_one_active_per_canteen" ON "CanteenQrCode"("canteenId") WHERE ("isActive");
CREATE INDEX "Canteen_serviceAreaId_idx" ON "Canteen"("serviceAreaId");
CREATE UNIQUE INDEX "Canteen_serviceAreaId_type_key" ON "Canteen"("serviceAreaId", "type");
-- Day/Night exclusivity, enforced by PostgreSQL: concurrent attempts to open
-- both canteens of one area cannot both commit.
CREATE UNIQUE INDEX "Canteen_one_open_per_service_area" ON "Canteen"("serviceAreaId") WHERE ("isActive" AND "isAcceptingOrders");
CREATE INDEX "Hostel_serviceAreaId_idx" ON "Hostel"("serviceAreaId");

ALTER TABLE "Canteen" ADD CONSTRAINT "Canteen_serviceAreaId_fkey" FOREIGN KEY ("serviceAreaId") REFERENCES "ServiceArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CanteenQrCode" ADD CONSTRAINT "CanteenQrCode_canteenId_fkey" FOREIGN KEY ("canteenId") REFERENCES "Canteen"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanteenQrCode" ADD CONSTRAINT "CanteenQrCode_uploadedByAdminId_fkey" FOREIGN KEY ("uploadedByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Hostel" ADD CONSTRAINT "Hostel_serviceAreaId_fkey" FOREIGN KEY ("serviceAreaId") REFERENCES "ServiceArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
