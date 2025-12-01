-- CreateEnum
CREATE TYPE "GroupMealBudget" AS ENUM ('UNDER_1000', 'UNDER_1500', 'UNDER_2000', 'OVER_2000');

-- AlterEnum
ALTER TYPE "GroupMealParticipantStatus" ADD VALUE 'LATE';

-- AlterTable
ALTER TABLE "GroupMeal" ADD COLUMN     "budget" "GroupMealBudget",
ADD COLUMN     "meetingPlace" VARCHAR(255);
