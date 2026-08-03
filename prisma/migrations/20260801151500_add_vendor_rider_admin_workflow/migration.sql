-- AlterEnum: new notification category for admin-driven account status
-- changes (vendor approve/deny/suspend, rider verify/reject/suspend), distinct
-- from the existing order/rider/payment/promo/wallet categories.
ALTER TYPE "NotificationType" ADD VALUE 'account';

-- AlterTable: admin-set reason surfaced to the vendor when storeStatus is
-- set to `denied` or `deactivated`.
ALTER TABLE "vendor_profiles" ADD COLUMN "storeStatusReason" TEXT;
