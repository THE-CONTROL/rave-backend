-- CreateIndex: hot filter/sort columns for order history, vendor dashboards,
-- and admin order listing — previously unindexed, forcing full table scans.
CREATE INDEX "orders_userId_createdAt_idx" ON "orders"("userId", "createdAt");
CREATE INDEX "orders_vendorId_status_idx" ON "orders"("vendorId", "status");
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex: delivery lookups by rider + status (active-delivery checks,
-- rider dashboards).
CREATE INDEX "deliveries_riderId_status_idx" ON "deliveries"("riderId", "status");

-- CreateIndex: rider_location_logs is written on every location ping and has
-- no retention job, so "latest location for rider" lookups need this index
-- to avoid degrading into full scans as the table grows unbounded.
CREATE INDEX "rider_location_logs_riderId_createdAt_idx" ON "rider_location_logs"("riderId", "createdAt");
