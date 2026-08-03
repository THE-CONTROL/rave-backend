-- AlterTable
ALTER TABLE "menu_item_ingredients" ADD COLUMN     "mealType" TEXT NOT NULL DEFAULT 'Side Dish',
ADD COLUMN     "price" DOUBLE PRECISION NOT NULL DEFAULT 0;
