/*
  Warnings:

  - You are about to drop the column `calories` on the `menu_items` table. All the data in the column will be lost.
  - You are about to drop the column `imageUrl` on the `menu_items` table. All the data in the column will be lost.
  - You are about to drop the column `prepTime` on the `menu_items` table. All the data in the column will be lost.
  - You are about to drop the column `serves` on the `menu_items` table. All the data in the column will be lost.
  - You are about to drop the `choice_groups` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `choice_options` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "choice_groups" DROP CONSTRAINT "choice_groups_menuItemId_fkey";

-- DropForeignKey
ALTER TABLE "choice_options" DROP CONSTRAINT "choice_options_groupId_fkey";

-- AlterTable
ALTER TABLE "menu_items" DROP COLUMN "calories",
DROP COLUMN "imageUrl",
DROP COLUMN "prepTime",
DROP COLUMN "serves",
ADD COLUMN     "isCustomizable" BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE "choice_groups";

-- DropTable
DROP TABLE "choice_options";

-- CreateTable
CREATE TABLE "menu_item_ingredients" (
    "id" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "portion" TEXT NOT NULL,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_item_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_item_images" (
    "id" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publicId" TEXT,
    "isMain" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "menu_item_images_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "menu_item_ingredients" ADD CONSTRAINT "menu_item_ingredients_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_images" ADD CONSTRAINT "menu_item_images_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
