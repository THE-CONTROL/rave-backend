-- CreateTable
CREATE TABLE "pending_orders" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "savedLocationId" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "contactMethod" TEXT NOT NULL DEFAULT 'in-app',
    "instructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_orders_reference_key" ON "pending_orders"("reference");
