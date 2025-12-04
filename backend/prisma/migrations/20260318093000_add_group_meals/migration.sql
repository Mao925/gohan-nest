DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'GroupMealBudget'
  ) THEN
    CREATE TYPE "GroupMealBudget" AS ENUM (
      'UNDER_1000',
      'UNDER_1500',
      'UNDER_2000',
      'OVER_2000'
    );
  END IF;
END$$;

-- CreateEnum "GroupMealStatus"
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'GroupMealStatus'
  ) THEN
    CREATE TYPE "GroupMealStatus" AS ENUM ('OPEN', 'FULL', 'CLOSED');
  END IF;
END $$;

-- CreateEnum "GroupMealParticipantStatus"
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'GroupMealParticipantStatus'
  ) THEN
    CREATE TYPE "GroupMealParticipantStatus" AS ENUM ('INVITED', 'JOINED', 'DECLINED', 'CANCELLED');
  END IF;
END $$;

-- Create or patch "GroupMeal" table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'GroupMeal'
  ) THEN
    CREATE TABLE "GroupMeal" (
      "id"          TEXT NOT NULL,
      "communityId" TEXT NOT NULL,
      "hostUserId"  TEXT NOT NULL,
      "title"       TEXT,
      "date"        TIMESTAMP(3) NOT NULL,
      "weekday"     "Weekday"   NOT NULL,
      "timeSlot"    "TimeSlot"  NOT NULL,
      "capacity"    INTEGER     NOT NULL,
      "status"      "GroupMealStatus" NOT NULL DEFAULT 'OPEN',
      "budget"      "GroupMealBudget",
      "meetingPlace" VARCHAR(255),
      "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"   TIMESTAMP(3) NOT NULL,

      CONSTRAINT "GroupMeal_pkey" PRIMARY KEY ("id")
    );
  ELSE
    -- もし既に存在する場合は、必要なカラムを補完する（shadow DB 向け）
    ALTER TABLE "GroupMeal"
      ADD COLUMN IF NOT EXISTS "communityId"  TEXT NOT NULL,
      ADD COLUMN IF NOT EXISTS "hostUserId"   TEXT NOT NULL,
      ADD COLUMN IF NOT EXISTS "title"        TEXT,
      ADD COLUMN IF NOT EXISTS "date"         TIMESTAMP(3) NOT NULL,
      ADD COLUMN IF NOT EXISTS "weekday"      "Weekday"   NOT NULL,
      ADD COLUMN IF NOT EXISTS "timeSlot"     "TimeSlot"  NOT NULL,
      ADD COLUMN IF NOT EXISTS "capacity"     INTEGER     NOT NULL,
      ADD COLUMN IF NOT EXISTS "status"       "GroupMealStatus" NOT NULL DEFAULT 'OPEN',
      ADD COLUMN IF NOT EXISTS "budget"       "GroupMealBudget",
      ADD COLUMN IF NOT EXISTS "meetingPlace" VARCHAR(255),
      ADD COLUMN IF NOT EXISTS "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "updatedAt"    TIMESTAMP(3) NOT NULL;
  END IF;
END $$;

-- Create or patch "GroupMealParticipant" table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'GroupMealParticipant'
  ) THEN
    CREATE TABLE "GroupMealParticipant" (
      "id"          TEXT NOT NULL,
      "groupMealId" TEXT NOT NULL,
      "userId"      TEXT NOT NULL,
      "isHost"      BOOLEAN NOT NULL DEFAULT false,
      "status"      "GroupMealParticipantStatus" NOT NULL DEFAULT 'INVITED',
      "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"   TIMESTAMP(3) NOT NULL,

      CONSTRAINT "GroupMealParticipant_pkey" PRIMARY KEY ("id")
    );
  ELSE
    ALTER TABLE "GroupMealParticipant"
      ADD COLUMN IF NOT EXISTS "groupMealId" TEXT NOT NULL,
      ADD COLUMN IF NOT EXISTS "userId"      TEXT NOT NULL,
      ADD COLUMN IF NOT EXISTS "isHost"      BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "status"      "GroupMealParticipantStatus" NOT NULL DEFAULT 'INVITED',
      ADD COLUMN IF NOT EXISTS "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "updatedAt"   TIMESTAMP(3) NOT NULL;
  END IF;
END $$;

-- CreateIndex (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'GroupMealParticipant'
      AND indexname  = 'GroupMealParticipant_groupMealId_userId_key'
  ) THEN
    CREATE UNIQUE INDEX "GroupMealParticipant_groupMealId_userId_key"
    ON "GroupMealParticipant"("groupMealId", "userId");
  END IF;
END $$;

-- AddForeignKey (if not exists)
DO $$
BEGIN
  -- GroupMeal.communityId -> Community.id
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name        = 'GroupMeal'
      AND constraint_name   = 'GroupMeal_communityId_fkey'
  ) THEN
    ALTER TABLE "GroupMeal"
    ADD CONSTRAINT "GroupMeal_communityId_fkey"
    FOREIGN KEY ("communityId") REFERENCES "Community"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- GroupMeal.hostUserId -> User.id
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name        = 'GroupMeal'
      AND constraint_name   = 'GroupMeal_hostUserId_fkey'
  ) THEN
    ALTER TABLE "GroupMeal"
    ADD CONSTRAINT "GroupMeal_hostUserId_fkey"
    FOREIGN KEY ("hostUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- GroupMealParticipant.groupMealId -> GroupMeal.id
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name        = 'GroupMealParticipant'
      AND constraint_name   = 'GroupMealParticipant_groupMealId_fkey'
  ) THEN
    ALTER TABLE "GroupMealParticipant"
    ADD CONSTRAINT "GroupMealParticipant_groupMealId_fkey"
    FOREIGN KEY ("groupMealId") REFERENCES "GroupMeal"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- GroupMealParticipant.userId -> User.id
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name        = 'GroupMealParticipant'
      AND constraint_name   = 'GroupMealParticipant_userId_fkey'
  ) THEN
    ALTER TABLE "GroupMealParticipant"
    ADD CONSTRAINT "GroupMealParticipant_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
