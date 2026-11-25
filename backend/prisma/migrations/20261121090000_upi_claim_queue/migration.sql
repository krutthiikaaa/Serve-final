-- UPI payment claims and the unpaid-order expiry window.
--
-- ADDITIVE ONLY: three nullable columns, two indexes and one CHECK on
-- "Payment". No existing row is updated or deleted.
--   * "claimedAt": when the student said "I've paid" (orders the cashier
--     queue; never proof of payment).
--   * "paymentDueAt": deadline for an unclaimed app payment. Existing rows
--     keep NULL, so payments created before this migration are never expired
--     automatically.
--   * "expiredAt": set when an unpaid, unclaimed order was cancelled
--     automatically.

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "expiredAt" TIMESTAMP(3),
ADD COLUMN     "paymentDueAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Payment_status_claimedAt_idx" ON "Payment"("status", "claimedAt");

-- CreateIndex
CREATE INDEX "Payment_status_paymentDueAt_idx" ON "Payment"("status", "paymentDueAt");

-- An expired payment is a failed one; it can never be claimed or settled.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_expired_is_failed_check"
  CHECK ("expiredAt" IS NULL OR "status" = 'FAILED');
