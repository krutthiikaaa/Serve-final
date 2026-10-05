-- Order item integrity (audit fixes). No table or column changes; data-preserving.

-- 1. Immutability with an escape hatch for referential cleanup.
--    The FK "OrderItem.menuItemId -> MenuItem ON DELETE SET NULL" is executed
--    by PostgreSQL as an UPDATE. The original trigger rejected every UPDATE,
--    which made hard-deleting a menu item with order history impossible.
--    Allow exactly one change: menuItemId -> NULL with every snapshot column
--    unchanged. Anything else is still rejected.
CREATE OR REPLACE FUNCTION "prevent_order_item_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."menuItemId" IS NULL
     AND OLD."menuItemId" IS NOT NULL
     AND NEW."id" = OLD."id"
     AND NEW."orderId" = OLD."orderId"
     AND NEW."itemName" = OLD."itemName"
     AND NEW."unitPricePaise" = OLD."unitPricePaise"
     AND NEW."quantity" = OLD."quantity"
     AND NEW."lineTotalPaise" = OLD."lineTotalPaise"
     AND NEW."createdAt" = OLD."createdAt" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'OrderItem rows are immutable snapshots' USING ERRCODE = 'check_violation';
END;
$$;

-- 2. An order item may only reference a menu item of the order's canteen.
CREATE FUNCTION "check_order_item_canteen"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."menuItemId" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "Order" o
    JOIN "MenuItem" m ON m."canteenId" = o."canteenId"
    WHERE o."id" = NEW."orderId" AND m."id" = NEW."menuItemId"
  ) THEN
    RAISE EXCEPTION 'OrderItem menu item must belong to the order''s canteen'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "OrderItem_same_canteen"
  BEFORE INSERT ON "OrderItem"
  FOR EACH ROW EXECUTE FUNCTION "check_order_item_canteen"();

-- 3. Totals fit comfortably in INTEGER: cap an order at ₹10,00,000.
ALTER TABLE "Order" ADD CONSTRAINT "Order_total_max_check" CHECK ("totalPaise" <= 100000000);
