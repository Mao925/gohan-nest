-- prisma/migrations/20251204113000_add_meal_time_slot_to_group_meal/migration.sql

DO $$
BEGIN
  --------------------------------------------------------------------------
  -- 1) TimeSlot 型がなければ作る
  --    ※ ここでは中身のラベルまでは触らない。新規環境用の保険だけ。
  --------------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'TimeSlot'
  ) THEN
    -- 新規環境用の暫定定義。既に TimeSlot がある本番には一切触らない。
    CREATE TYPE "TimeSlot" AS ENUM ('TEMP_DUMMY');
  END IF;
END$$;

---------------------------------------------------------------------------
-- 2) GroupMeal テーブルに mealTimeSlot カラムを追加（存在しなければ）
--    デフォルト値も NOT NULL 制約もここでは付けない。
--    → 既存 DB の TimeSlot ラベル構成に依存しないようにする。
---------------------------------------------------------------------------
ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "mealTimeSlot" "TimeSlot";
