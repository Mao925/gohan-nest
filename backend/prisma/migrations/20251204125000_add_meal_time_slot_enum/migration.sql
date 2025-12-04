-- prisma/migrations/20251204125000_add_meal_time_slot_enum/migration.sql

DO $$
BEGIN
  -- MealTimeSlot 型がまだない場合だけ作成する
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'MealTimeSlot'
  ) THEN
    CREATE TYPE "MealTimeSlot" AS ENUM (
      'LUNCH',
      'DINNER'
    );
  END IF;
END$$;
