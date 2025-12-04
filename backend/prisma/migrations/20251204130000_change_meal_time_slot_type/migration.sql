-- prisma/migrations/20251204130000_change_meal_time_slot_type/migration.sql

DO $$
BEGIN
  -- mealTimeSlot カラムが存在する場合だけ型変更を行う
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'GroupMeal'
      AND column_name  = 'mealTimeSlot'
  ) THEN
    ALTER TABLE "GroupMeal"
      ALTER COLUMN "mealTimeSlot"
      TYPE "MealTimeSlot"
      USING ("mealTimeSlot"::text::"MealTimeSlot");
  END IF;
END$$;
