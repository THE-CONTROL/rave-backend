-- CreateTable: implicit many-to-many join between menu items and reusable
-- option groups, so a single option group can be attached to many items.
CREATE TABLE "_MenuItemOptionGroups" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_MenuItemOptionGroups_AB_unique" ON "_MenuItemOptionGroups"("A", "B");
CREATE INDEX "_MenuItemOptionGroups_B_index" ON "_MenuItemOptionGroups"("B");

-- AddForeignKey ("A" = menu_items, "B" = option_groups — alphabetical by model)
ALTER TABLE "_MenuItemOptionGroups" ADD CONSTRAINT "_MenuItemOptionGroups_A_fkey" FOREIGN KEY ("A") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_MenuItemOptionGroups" ADD CONSTRAINT "_MenuItemOptionGroups_B_fkey" FOREIGN KEY ("B") REFERENCES "option_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
