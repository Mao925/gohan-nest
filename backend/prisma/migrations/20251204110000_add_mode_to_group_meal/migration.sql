-- Add mode column to GroupMeal (and GroupMealMode type if needed)

DO $$
BEGIN
  -- GroupMealMode 型がまだ無い環境向けの保険（あれば何もしない）
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'GroupMealMode'
  ) THEN
    CREATE TYPE "GroupMealMode" AS ENUM (
      'REAL',
      'MEET'
      -- schema.prisma の enum GroupMealMode に合わせて増やす
    );
  END IF;
END$$;

-- GroupMeal テーブルに mode カラムを追加
ALTER TABLE "GroupMeal"
  ADD COLUMN IF NOT EXISTS "mode" "GroupMealMode" NOT NULL DEFAULT 'REAL';
  -- もし schema.prisma 側で mode が optional なら ↑ の NOT NULL / DEFAULT は外す：
  -- ADD COLUMN IF NOT EXISTS "mode" "GroupMealMode";