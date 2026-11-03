-- Per-canteen DEMO/LIVE payment mode and simulated payment flag.
-- Existing canteens become DEMO. Existing payments stay isSimulated = false.
-- Official UPI/QR fields are not treated as LIVE.

CREATE TYPE "PaymentMode" AS ENUM ('DEMO', 'LIVE');

ALTER TABLE "CanteenPaymentConfig"
  ADD COLUMN "mode" "PaymentMode" NOT NULL DEFAULT 'DEMO';

INSERT INTO "CanteenPaymentConfig" (
  "id",
  "canteenId",
  "mode",
  "isActive",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  c."id",
  'DEMO',
  false,
  NOW(),
  NOW()
FROM "Canteen" c
LEFT JOIN "CanteenPaymentConfig" p ON p."canteenId" = c."id"
WHERE p."id" IS NULL;

ALTER TABLE "Payment"
  ADD COLUMN "isSimulated" BOOLEAN NOT NULL DEFAULT false;
