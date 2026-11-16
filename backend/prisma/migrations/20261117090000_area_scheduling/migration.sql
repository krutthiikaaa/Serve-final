-- Automatic + manual Day/Night switching per service area, and a pause flag
-- that is separate from "on duty".
--
-- NON-DESTRUCTIVE: only adds columns (with defaults) and an enum. No row is
-- changed. Every area starts with automatic switching OFF and no override,
-- so behaviour is unchanged until an admin configures a schedule.

CREATE TYPE "AreaOverrideTarget" AS ENUM ('DAY', 'NIGHT', 'NONE');

-- A temporary pause by staff/admin, never touched by the scheduler.
ALTER TABLE "Canteen" ADD COLUMN "isPaused" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ServiceArea"
  ADD COLUMN "autoSwitchEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN "dayOpensAtMinutes" INTEGER,
  ADD COLUMN "dayClosesAtMinutes" INTEGER,
  ADD COLUMN "nightOpensAtMinutes" INTEGER,
  ADD COLUMN "nightClosesAtMinutes" INTEGER,
  ADD COLUMN "overrideTarget" "AreaOverrideTarget",
  ADD COLUMN "overrideUntil" TIMESTAMP(3),
  ADD COLUMN "overrideSetAt" TIMESTAMP(3),
  ADD COLUMN "overrideByAdminId" UUID;

-- Times are minutes from local midnight; a window is fully set or fully unset.
ALTER TABLE "ServiceArea" ADD CONSTRAINT "ServiceArea_schedule_minutes_check" CHECK (
  ("dayOpensAtMinutes" IS NULL OR "dayOpensAtMinutes" BETWEEN 0 AND 1439) AND
  ("dayClosesAtMinutes" IS NULL OR "dayClosesAtMinutes" BETWEEN 0 AND 1439) AND
  ("nightOpensAtMinutes" IS NULL OR "nightOpensAtMinutes" BETWEEN 0 AND 1439) AND
  ("nightClosesAtMinutes" IS NULL OR "nightClosesAtMinutes" BETWEEN 0 AND 1439) AND
  (("dayOpensAtMinutes" IS NULL) = ("dayClosesAtMinutes" IS NULL)) AND
  (("nightOpensAtMinutes" IS NULL) = ("nightClosesAtMinutes" IS NULL))
);
-- An override is either fully absent or has a target and a start time.
ALTER TABLE "ServiceArea" ADD CONSTRAINT "ServiceArea_override_consistency_check" CHECK (
  ("overrideTarget" IS NULL) = ("overrideSetAt" IS NULL) AND
  ("overrideTarget" IS NOT NULL OR "overrideUntil" IS NULL)
);
