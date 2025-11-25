-- Add favoriteMeals string array to profiles
ALTER TABLE "Profile"
ADD COLUMN "favoriteMeals" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
