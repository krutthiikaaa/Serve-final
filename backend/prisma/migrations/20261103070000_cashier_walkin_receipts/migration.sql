-- Additive cashier / walk-in / receipt support. Existing orders stay APP
-- with a required student. Receipt numbers are allocated only on SUCCESS.

CREATE TYPE "OrderChannel" AS ENUM ('APP', 'WALK_IN');

ALTER TYPE "PaymentProvider" ADD VALUE 'UPI';
ALTER TYPE "PaymentProvider" ADD VALUE 'CASH';

CREATE SEQUENCE "receipt_number_seq" START WITH 1001;

ALTER TABLE "Order" ADD COLUMN "receiptNumber" TEXT;
ALTER TABLE "Order" ADD COLUMN "channel" "OrderChannel" NOT NULL DEFAULT 'APP';
ALTER TABLE "Order" ADD COLUMN "guestName" TEXT;

ALTER TABLE "Order" DROP CONSTRAINT "Order_studentId_fkey";
ALTER TABLE "Order" ALTER COLUMN "studentId" DROP NOT NULL;
ALTER TABLE "Order" ADD CONSTRAINT "Order_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Order" ADD CONSTRAINT "Order_channel_student_check" CHECK (
  ("channel" = 'APP' AND "studentId" IS NOT NULL) OR
  ("channel" = 'WALK_IN' AND "studentId" IS NULL)
);

CREATE UNIQUE INDEX "Order_receiptNumber_key" ON "Order"("receiptNumber");
CREATE INDEX "Order_canteenId_channel_status_createdAt_idx"
  ON "Order"("canteenId", "channel", "status", "createdAt");

ALTER TABLE "Payment" ADD COLUMN "utr" TEXT;
ALTER TABLE "Payment" ADD COLUMN "verifiedByStaffId" UUID;
ALTER TABLE "Payment" ADD COLUMN "verifiedAt" TIMESTAMP(3);

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_verifiedByStaffId_fkey"
  FOREIGN KEY ("verifiedByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Payment_verifiedByStaffId_idx" ON "Payment"("verifiedByStaffId");
