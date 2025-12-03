-- CreateEnum
-- CREATE TYPE "ScheduleTimeBand" AS ENUM ('LUNCH', 'DINNER');

-- CreateEnum ScheduleTimeBand (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'ScheduleTimeBand'
  ) THEN
    CREATE TYPE "ScheduleTimeBand" AS ENUM (
      'LUNCH',
      'DINNER'
    );
  END IF;
END $$;

-- CreateEnum
-- CREATE TYPE "PairMealStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

-- CreateEnum PairMealStatus (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'PairMealStatus'
  ) THEN
    CREATE TYPE "PairMealStatus" AS ENUM (
      'CONFIRMED',
      'CANCELLED'
    );
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "GroupMealMode" AS ENUM ('REAL', 'MEET');

-- CreateEnum
CREATE TYPE "MealTimeSlot" AS ENUM ('LUNCH', 'DINNER');

-- AlterEnum
ALTER TYPE "AvailabilityStatus" ADD VALUE 'MEET_ONLY';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "GroupMealParticipantStatus" ADD VALUE 'PENDING';
ALTER TYPE "GroupMealParticipantStatus" ADD VALUE 'GO';
ALTER TYPE "GroupMealParticipantStatus" ADD VALUE 'NOT_GO';

-- AlterTable
ALTER TABLE "GroupMeal" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "hostMembershipId" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "locationName" TEXT,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "mealTimeSlot" "MealTimeSlot",
ADD COLUMN     "meetUrl" TEXT,
ADD COLUMN     "meetingTimeMinutes" INTEGER,
ADD COLUMN     "mode" "GroupMealMode" NOT NULL DEFAULT 'REAL',
ADD COLUMN     "placeAddress" TEXT,
ADD COLUMN     "placeGooglePlaceId" TEXT,
ADD COLUMN     "placeLatitude" DOUBLE PRECISION,
ADD COLUMN     "placeLongitude" DOUBLE PRECISION,
ADD COLUMN     "placeName" TEXT,
ADD COLUMN     "talkTopics" TEXT[];

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "hobbies" TEXT[] DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "name" DROP NOT NULL,
ALTER COLUMN "isSeedMember" DROP NOT NULL,
ALTER COLUMN "isSeedMember" DROP DEFAULT;

-- CreateTable
CREATE TABLE "PairMeal" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "memberAId" TEXT NOT NULL,
    "memberBId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "timeBand" "ScheduleTimeBand" NOT NULL,
    "meetingTimeMinutes" INTEGER,
    "placeName" TEXT,
    "placeAddress" TEXT,
    "placeLatitude" DOUBLE PRECISION,
    "placeLongitude" DOUBLE PRECISION,
    "placeGooglePlaceId" TEXT,
    "restaurantName" TEXT,
    "restaurantAddress" TEXT,
    "status" "PairMealStatus" NOT NULL DEFAULT 'CONFIRMED',
    "createdByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PairMeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMealCandidate" (
    "id" TEXT NOT NULL,
    "groupMealId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isCanceled" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),
    "firstOpenedAt" TIMESTAMP(3),
    "lastOpenedAt" TIMESTAMP(3),

    CONSTRAINT "GroupMealCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupMealCandidate_groupMealId_idx" ON "GroupMealCandidate"("groupMealId");

-- CreateIndex
CREATE INDEX "GroupMealCandidate_userId_idx" ON "GroupMealCandidate"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMealCandidate_groupMealId_userId_key" ON "GroupMealCandidate"("groupMealId", "userId");

-- AddForeignKey
ALTER TABLE "PairMeal" ADD CONSTRAINT "PairMeal_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PairMeal" ADD CONSTRAINT "PairMeal_memberAId_fkey" FOREIGN KEY ("memberAId") REFERENCES "CommunityMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PairMeal" ADD CONSTRAINT "PairMeal_memberBId_fkey" FOREIGN KEY ("memberBId") REFERENCES "CommunityMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PairMeal" ADD CONSTRAINT "PairMeal_createdByMemberId_fkey" FOREIGN KEY ("createdByMemberId") REFERENCES "CommunityMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMeal" ADD CONSTRAINT "GroupMeal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMeal" ADD CONSTRAINT "GroupMeal_hostMembershipId_fkey" FOREIGN KEY ("hostMembershipId") REFERENCES "CommunityMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMealCandidate" ADD CONSTRAINT "GroupMealCandidate_groupMealId_fkey" FOREIGN KEY ("groupMealId") REFERENCES "GroupMeal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMealCandidate" ADD CONSTRAINT "GroupMealCandidate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMealCandidate" ADD CONSTRAINT "GroupMealCandidate_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
