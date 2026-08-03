-- CreateTable
CREATE TABLE "option_groups" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customizationType" TEXT NOT NULL,
    "baseQuantity" INTEGER,
    "pricePerExtra" DOUBLE PRECISION,
    "quantityPerExtra" INTEGER,
    "minQuantity" INTEGER,
    "maxQuantity" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "option_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "option_items" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "option_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "option_sizes" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "extraPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "option_sizes_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "option_groups" ADD CONSTRAINT "option_groups_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_items" ADD CONSTRAINT "option_items_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "option_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_sizes" ADD CONSTRAINT "option_sizes_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "option_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
