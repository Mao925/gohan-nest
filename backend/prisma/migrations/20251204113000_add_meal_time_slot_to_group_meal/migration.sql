-- Add mealTimeSlot column to GroupMeal (and TimeSlot type if needed)

DO $$
BEGIN
  -- TimeSlot 型がまだ無い場合だけ作る（あれば何もしない）
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'TimeSlot'
  ) THEN
    CREATE TYPE "TimeSlot" AS ENUM (
      'LUNCH',
      'DINNER'
      -- schema.prisma の enum TimeSlot に合わせて増やす
    );
  END IF;
END$$;

-- GroupMeal テーブルに mealTimeSlot カラムを追加
ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "mealTimeSlot" "TimeSlot" NOT NULL DEFAULT 'LUNCH';
  -- もし schema.prisma 側が optional（`TimeSlot?`）なら NOT NULL / DEFAULT は消す：
  -- ADD COLUMN IF NOT EXISTS "mealTimeSlot" "TimeSlot";
  