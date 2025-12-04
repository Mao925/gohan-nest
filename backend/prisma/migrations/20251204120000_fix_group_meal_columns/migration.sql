-- prisma/migrations/20251204120000_fix_group_meal_columns/migration.sql

-- 1) GroupMeal テーブルがなければ最低限の形で作る
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'GroupMeal'
  ) THEN
    CREATE TABLE "GroupMeal" (
      "id" TEXT PRIMARY KEY
    );
  END IF;
END$$;

-- 2) GroupMeal の各カラムを足す（既にあれば何もしない）

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "communityId" TEXT;

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "hostUserId" TEXT;

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "hostMembershipId" TEXT;

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "title" TEXT;

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "date" TIMESTAMP(3);

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "weekday" "Weekday";

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "timeSlot" "TimeSlot";

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "mode" "GroupMealMode";

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "mealTimeSlot" "MealTimeSlot";

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "locationName" TEXT;

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION;

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "meetUrl" TEXT;

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "talkTopics" TEXT[];

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "createdById" TEXT;

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "capacity" INTEGER;

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "status" "GroupMealStatus";

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3);

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "budget" "GroupMealBudget";

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "meetingPlace" VARCHAR(255);

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "meetingTimeMinutes" INTEGER;

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "placeName" TEXT;

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "placeAddress" TEXT;

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "placeLatitude" DOUBLE PRECISION;

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "placeLongitude" DOUBLE PRECISION;

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "placeGooglePlaceId" TEXT;

ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
