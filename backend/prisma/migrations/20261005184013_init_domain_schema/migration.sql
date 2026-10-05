-- CreateEnum
CREATE TYPE "StaffStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PLACED', 'PAYMENT_CONFIRMED', 'PREPARING', 'READY', 'COLLECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('MOCK', 'RAZORPAY');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ORDER_PLACED', 'PAYMENT_CONFIRMED', 'ORDER_PREPARING', 'ORDER_READY', 'ORDER_COLLECTED', 'ORDER_CANCELLED', 'STAFF_ACCESS_REQUESTED', 'STAFF_APPROVED', 'STAFF_REJECTED', 'STAFF_CANTEEN_ASSIGNED', 'STAFF_DEACTIVATED', 'CANTEEN_UPDATE');

-- CreateTable
CREATE TABLE "Canteen" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "location" TEXT,
    "openingHours" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isAcceptingOrders" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Canteen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hostel" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "canteenId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hostel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" UUID NOT NULL,
    "firebaseUid" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hostelId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" UUID NOT NULL,
    "firebaseUid" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "StaffStatus" NOT NULL DEFAULT 'PENDING',
    "canteenId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admin" (
    "id" UUID NOT NULL,
    "firebaseUid" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanteenChangeRequest" (
    "id" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "requestedCanteenId" UUID NOT NULL,
    "fromCanteenId" UUID,
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "reviewNotes" TEXT,
    "reviewedByAdminId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanteenChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuCategory" (
    "id" UUID NOT NULL,
    "canteenId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItem" (
    "id" UUID NOT NULL,
    "canteenId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pricePaise" INTEGER NOT NULL,
    "imageUrl" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);

-- Public order numbers: 'SV' || nextval  (SV1001, SV1002, ...).
-- Independent from internal UUIDs; created before "Order" references it.
CREATE SEQUENCE "order_number_seq" START WITH 1001 INCREMENT BY 1 NO CYCLE;

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "orderNumber" TEXT NOT NULL DEFAULT ('SV'::text || nextval('order_number_seq'::regclass)),
    "studentId" UUID NOT NULL,
    "canteenId" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PLACED',
    "totalPaise" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "preparingAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "collectedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "menuItemId" UUID,
    "itemName" TEXT NOT NULL,
    "unitPricePaise" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotalPaise" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "providerOrderId" TEXT,
    "providerPaymentId" TEXT,
    "signature" TEXT,
    "failureReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedPaymentEvent" (
    "id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "eventId" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedPaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "studentId" UUID,
    "staffId" UUID,
    "adminId" UUID,
    "orderId" UUID,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Canteen_name_key" ON "Canteen"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Canteen_slug_key" ON "Canteen"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Hostel_name_key" ON "Hostel"("name");

-- CreateIndex
CREATE INDEX "Hostel_canteenId_idx" ON "Hostel"("canteenId");

-- CreateIndex
CREATE UNIQUE INDEX "Student_firebaseUid_key" ON "Student"("firebaseUid");

-- CreateIndex
CREATE UNIQUE INDEX "Student_email_key" ON "Student"("email");

-- CreateIndex
CREATE INDEX "Student_hostelId_idx" ON "Student"("hostelId");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_firebaseUid_key" ON "Staff"("firebaseUid");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_email_key" ON "Staff"("email");

-- CreateIndex
CREATE INDEX "Staff_canteenId_idx" ON "Staff"("canteenId");

-- CreateIndex
CREATE INDEX "Staff_status_idx" ON "Staff"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_firebaseUid_key" ON "Admin"("firebaseUid");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");

-- CreateIndex
CREATE INDEX "CanteenChangeRequest_staffId_createdAt_idx" ON "CanteenChangeRequest"("staffId", "createdAt");

-- CreateIndex
CREATE INDEX "CanteenChangeRequest_status_createdAt_idx" ON "CanteenChangeRequest"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CanteenChangeRequest_one_pending_per_staff" ON "CanteenChangeRequest"("staffId") WHERE (status = 'PENDING');

-- CreateIndex
CREATE INDEX "MenuCategory_canteenId_idx" ON "MenuCategory"("canteenId");

-- CreateIndex
CREATE UNIQUE INDEX "MenuCategory_canteenId_name_key" ON "MenuCategory"("canteenId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "MenuCategory_id_canteenId_key" ON "MenuCategory"("id", "canteenId");

-- CreateIndex
CREATE INDEX "MenuItem_canteenId_idx" ON "MenuItem"("canteenId");

-- CreateIndex
CREATE INDEX "MenuItem_categoryId_idx" ON "MenuItem"("categoryId");

-- CreateIndex
CREATE INDEX "MenuItem_canteenId_isAvailable_idx" ON "MenuItem"("canteenId", "isAvailable");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItem_canteenId_name_key" ON "MenuItem"("canteenId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE INDEX "Order_studentId_createdAt_idx" ON "Order"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_canteenId_status_createdAt_idx" ON "Order"("canteenId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "Order_idempotencyKey_idx" ON "Order"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Order_studentId_idempotencyKey_key" ON "Order"("studentId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_menuItemId_idx" ON "OrderItem"("menuItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_orderId_key" ON "Payment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerOrderId_key" ON "Payment"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerPaymentId_key" ON "Payment"("providerPaymentId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedPaymentEvent_provider_eventId_key" ON "ProcessedPaymentEvent"("provider", "eventId");

-- CreateIndex
CREATE INDEX "Notification_studentId_createdAt_idx" ON "Notification"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_staffId_createdAt_idx" ON "Notification"("staffId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_adminId_createdAt_idx" ON "Notification"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- AddForeignKey
ALTER TABLE "Hostel" ADD CONSTRAINT "Hostel_canteenId_fkey" FOREIGN KEY ("canteenId") REFERENCES "Canteen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "Hostel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_canteenId_fkey" FOREIGN KEY ("canteenId") REFERENCES "Canteen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanteenChangeRequest" ADD CONSTRAINT "CanteenChangeRequest_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanteenChangeRequest" ADD CONSTRAINT "CanteenChangeRequest_requestedCanteenId_fkey" FOREIGN KEY ("requestedCanteenId") REFERENCES "Canteen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanteenChangeRequest" ADD CONSTRAINT "CanteenChangeRequest_fromCanteenId_fkey" FOREIGN KEY ("fromCanteenId") REFERENCES "Canteen"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanteenChangeRequest" ADD CONSTRAINT "CanteenChangeRequest_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuCategory" ADD CONSTRAINT "MenuCategory_canteenId_fkey" FOREIGN KEY ("canteenId") REFERENCES "Canteen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_canteenId_fkey" FOREIGN KEY ("canteenId") REFERENCES "Canteen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_categoryId_canteenId_fkey" FOREIGN KEY ("categoryId", "canteenId") REFERENCES "MenuCategory"("id", "canteenId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_canteenId_fkey" FOREIGN KEY ("canteenId") REFERENCES "Canteen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- Business-rule constraints not expressible in the Prisma schema
-- =============================================================================

-- Emails are stored normalized (lower-case, trimmed) so uniqueness is case-insensitive.
ALTER TABLE "Student" ADD CONSTRAINT "Student_email_normalized_check" CHECK ("email" = lower(btrim("email")));
ALTER TABLE "Staff"   ADD CONSTRAINT "Staff_email_normalized_check"   CHECK ("email" = lower(btrim("email")));
ALTER TABLE "Admin"   ADD CONSTRAINT "Admin_email_normalized_check"   CHECK ("email" = lower(btrim("email")));

-- Approved staff must be assigned to a canteen.
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_approved_requires_canteen_check"
  CHECK ("status" <> 'APPROVED' OR "canteenId" IS NOT NULL);

-- A change request cannot target the canteen the staff member is moving from.
ALTER TABLE "CanteenChangeRequest" ADD CONSTRAINT "CanteenChangeRequest_distinct_canteens_check"
  CHECK ("fromCanteenId" IS NULL OR "fromCanteenId" <> "requestedCanteenId");

-- Reviewed requests record who reviewed them and when.
ALTER TABLE "CanteenChangeRequest" ADD CONSTRAINT "CanteenChangeRequest_review_consistency_check"
  CHECK (("status" = 'PENDING') = ("reviewedAt" IS NULL));

-- Money and quantities.
ALTER TABLE "MenuItem"  ADD CONSTRAINT "MenuItem_price_positive_check"     CHECK ("pricePaise" > 0);
ALTER TABLE "Order"     ADD CONSTRAINT "Order_total_positive_check"        CHECK ("totalPaise" > 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_unit_price_positive_check" CHECK ("unitPricePaise" > 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantity_range_check"    CHECK ("quantity" BETWEEN 1 AND 20);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_line_total_check"        CHECK ("lineTotalPaise" = "unitPricePaise" * "quantity");
ALTER TABLE "Payment"   ADD CONSTRAINT "Payment_amount_positive_check"     CHECK ("amountPaise" > 0);

-- Idempotency keys: bounded, URL-safe.
ALTER TABLE "Order" ADD CONSTRAINT "Order_idempotency_key_format_check"
  CHECK ("idempotencyKey" ~ '^[A-Za-z0-9_-]{8,128}$');

-- Every notification has exactly one recipient.
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_single_recipient_check"
  CHECK (num_nonnulls("studentId", "staffId", "adminId") = 1);

-- Order item snapshots are immutable: historical orders never change when the menu does.
CREATE FUNCTION "prevent_order_item_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'OrderItem rows are immutable snapshots' USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER "OrderItem_immutable"
  BEFORE UPDATE ON "OrderItem"
  FOR EACH ROW EXECUTE FUNCTION "prevent_order_item_update"();
