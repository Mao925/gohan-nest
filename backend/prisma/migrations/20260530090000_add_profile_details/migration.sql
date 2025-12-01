-- CreateEnum
CREATE TYPE "DrinkingStyle" AS ENUM ('NO_ALCOHOL', 'SOMETIMES', 'ENJOY_DRINKING');

-- CreateEnum
CREATE TYPE "MealStyle" AS ENUM ('TALK_DEEP', 'CASUAL_CHAT', 'BRAINSTORM');

-- CreateEnum
CREATE TYPE "GoMealFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN "mainArea" TEXT;
ALTER TABLE "Profile" ADD COLUMN "subAreas" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Profile" ADD COLUMN "defaultBudget" "GroupMealBudget";
ALTER TABLE "Profile" ADD COLUMN "drinkingStyle" "DrinkingStyle";
ALTER TABLE "Profile" ADD COLUMN "ngFoods" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Profile" ADD COLUMN "bio" TEXT;
ALTER TABLE "Profile" ADD COLUMN "mealStyle" "MealStyle";
ALTER TABLE "Profile" ADD COLUMN "goMealFrequency" "GoMealFrequency";
