-- AlterTable: track who cancelled an order so analytics can split
-- vendor-declined ("store") from customer-cancelled ("user") orders.
ALTER TABLE "orders" ADD COLUMN "cancelledBy" TEXT;
