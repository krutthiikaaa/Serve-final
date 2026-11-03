-- CreateEnum
CREATE TYPE "ServicePeriod" AS ENUM ('DAY', 'NIGHT');

-- CreateEnum
CREATE TYPE "ScheduleOverride" AS ENUM ('AUTO', 'FORCE_OPEN', 'FORCE_CLOSED');

-- CreateEnum
CREATE TYPE "StaffCapability" AS ENUM ('KITCHEN', 'MENU', 'PAUSE', 'CASHIER');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "servicePeriod" "ServicePeriod";

-- CreateTable
CREATE TABLE "CanteenService" (
    "id" UUID NOT NULL,
    "canteenId" UUID NOT NULL,
    "period" "ServicePeriod" NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "override" "ScheduleOverride" NOT NULL DEFAULT 'FORCE_OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanteenService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanteenOperatingSchedule" (
    "id" UUID NOT NULL,
    "canteenServiceId" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "opensAtMinutes" INTEGER NOT NULL,
    "closesAtMinutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanteenOperatingSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanteenPaymentConfig" (
    "id" UUID NOT NULL,
    "canteenId" UUID NOT NULL,
    "upiVpa" TEXT,
    "merchantName" TEXT,
    "qrImageUrl" TEXT,
    "qrStorageKey" TEXT,
    "instructions" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanteenPaymentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffCanteenAssignment" (
    "id" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "canteenId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffCanteenAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAssignmentCapability" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "capability" "StaffCapability" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAssignmentCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItemService" (
    "id" UUID NOT NULL,
    "menuItemId" UUID NOT NULL,
    "period" "ServicePeriod" NOT NULL,
    "pricePaise" INTEGER NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuItemService_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CanteenService_canteenId_idx" ON "CanteenService"("canteenId");

-- CreateIndex
CREATE UNIQUE INDEX "CanteenService_canteenId_period_key" ON "CanteenService"("canteenId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "CanteenOperatingSchedule_canteenServiceId_weekday_key" ON "CanteenOperatingSchedule"("canteenServiceId", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "CanteenPaymentConfig_canteenId_key" ON "CanteenPaymentConfig"("canteenId");

-- CreateIndex
CREATE INDEX "StaffCanteenAssignment_staffId_idx" ON "StaffCanteenAssignment"("staffId");

-- CreateIndex
CREATE INDEX "StaffCanteenAssignment_canteenId_idx" ON "StaffCanteenAssignment"("canteenId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffCanteenAssignment_staffId_canteenId_key" ON "StaffCanteenAssignment"("staffId", "canteenId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffAssignmentCapability_assignmentId_capability_key" ON "StaffAssignmentCapability"("assignmentId", "capability");

-- CreateIndex
CREATE INDEX "MenuItemService_period_idx" ON "MenuItemService"("period");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItemService_menuItemId_period_key" ON "MenuItemService"("menuItemId", "period");

-- AddForeignKey
ALTER TABLE "CanteenService" ADD CONSTRAINT "CanteenService_canteenId_fkey" FOREIGN KEY ("canteenId") REFERENCES "Canteen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanteenOperatingSchedule" ADD CONSTRAINT "CanteenOperatingSchedule_canteenServiceId_fkey" FOREIGN KEY ("canteenServiceId") REFERENCES "CanteenService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanteenPaymentConfig" ADD CONSTRAINT "CanteenPaymentConfig_canteenId_fkey" FOREIGN KEY ("canteenId") REFERENCES "Canteen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffCanteenAssignment" ADD CONSTRAINT "StaffCanteenAssignment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffCanteenAssignment" ADD CONSTRAINT "StaffCanteenAssignment_canteenId_fkey" FOREIGN KEY ("canteenId") REFERENCES "Canteen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAssignmentCapability" ADD CONSTRAINT "StaffAssignmentCapability_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "StaffCanteenAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemService" ADD CONSTRAINT "MenuItemService_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- Business-rule constraints not expressible in the Prisma schema.
-- Zero-length windows and adjacent-day overlap are validated in the application.
-- Staff_approved_requires_canteen_check is unchanged.
-- =============================================================================

ALTER TABLE "MenuItemService" ADD CONSTRAINT "MenuItemService_price_positive_check" CHECK ("pricePaise" > 0);

ALTER TABLE "CanteenOperatingSchedule" ADD CONSTRAINT "CanteenOperatingSchedule_weekday_check"
  CHECK ("weekday" BETWEEN 1 AND 7);

ALTER TABLE "CanteenOperatingSchedule" ADD CONSTRAINT "CanteenOperatingSchedule_opensAtMinutes_check"
  CHECK ("opensAtMinutes" BETWEEN 0 AND 1439);

ALTER TABLE "CanteenOperatingSchedule" ADD CONSTRAINT "CanteenOperatingSchedule_closesAtMinutes_check"
  CHECK ("closesAtMinutes" BETWEEN 0 AND 1439);

-- BEGIN BACKFILL
INSERT INTO "CanteenService" ("id", "canteenId", "period", "isEnabled", "override", "createdAt", "updatedAt")
SELECT gen_random_uuid(), c."id", 'NIGHT', true, 'FORCE_OPEN', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Canteen" c
WHERE NOT EXISTS (
  SELECT 1 FROM "CanteenService" s
  WHERE s."canteenId" = c."id" AND s."period" = 'NIGHT'
);

INSERT INTO "MenuItemService" ("id", "menuItemId", "period", "pricePaise", "isAvailable", "createdAt", "updatedAt")
SELECT gen_random_uuid(), m."id", 'NIGHT', m."pricePaise", m."isAvailable", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "MenuItem" m
WHERE NOT EXISTS (
  SELECT 1 FROM "MenuItemService" s
  WHERE s."menuItemId" = m."id" AND s."period" = 'NIGHT'
);

INSERT INTO "StaffCanteenAssignment" ("id", "staffId", "canteenId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), s."id", s."canteenId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Staff" s
WHERE s."canteenId" IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM "StaffCanteenAssignment" a
  WHERE a."staffId" = s."id" AND a."canteenId" = s."canteenId"
);

INSERT INTO "StaffAssignmentCapability" ("id", "assignmentId", "capability", "createdAt")
SELECT gen_random_uuid(), a."id", cap.capability, CURRENT_TIMESTAMP
FROM "StaffCanteenAssignment" a
CROSS JOIN (
  VALUES
    ('KITCHEN'::"StaffCapability"),
    ('MENU'::"StaffCapability"),
    ('PAUSE'::"StaffCapability")
) AS cap(capability)
WHERE NOT EXISTS (
  SELECT 1 FROM "StaffAssignmentCapability" c
  WHERE c."assignmentId" = a."id" AND c."capability" = cap.capability
);
-- END BACKFILL
