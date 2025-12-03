-- Ensure enum type "GroupMealParticipantStatus" exists for this migration
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'GroupMealParticipantStatus'
  ) THEN
    CREATE TYPE "GroupMealParticipantStatus" AS ENUM (
      'INVITED',
      'JOINED',
      'DECLINED',
      'CANCELLED'
    );
  END IF;
END $$;

-- CreateEnum for budget
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'GroupMealBudget'
  ) THEN
    CREATE TYPE "GroupMealBudget" AS ENUM ('UNDER_1000', 'UNDER_1500', 'UNDER_2000', 'OVER_2000');
  END IF;
END $$;

-- AlterEnum: add 'LATE' status if missing
ALTER TYPE "GroupMealParticipantStatus" ADD VALUE IF NOT EXISTS 'LATE';

-- If the GroupMeal table already exists (本番DBなど) なら budget / meetingPlace を足す
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'GroupMeal'
  ) THEN
    -- budget カラム
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'GroupMeal'
        AND column_name  = 'budget'
    ) THEN
      ALTER TABLE "GroupMeal" ADD COLUMN "budget" "GroupMealBudget";
    END IF;

    -- meetingPlace カラム
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'GroupMeal'
        AND column_name  = 'meetingPlace'
    ) THEN
      ALTER TABLE "GroupMeal" ADD COLUMN "meetingPlace" VARCHAR(255);
    END IF;
  END IF;
END $$;
