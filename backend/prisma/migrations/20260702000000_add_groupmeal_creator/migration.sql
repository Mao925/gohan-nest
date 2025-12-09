-- Renaming the creator column for consistency and tracking which user created each GroupMeal
ALTER TABLE "GroupMeal" RENAME COLUMN "createdById" TO "createdByUserId";

-- Enforce referential integrity so that we can check the creator at runtime
ALTER TABLE "GroupMeal"
  ADD CONSTRAINT "GroupMeal_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
