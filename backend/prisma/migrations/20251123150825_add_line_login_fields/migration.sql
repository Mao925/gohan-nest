-- 20251123150825_add_line_login_fields
-- このマイグレーションは、LINE ログイン用のカラムが
-- 無い環境だけで安全に適用されるようにしている

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "lineUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "lineDisplayName" TEXT,
  ADD COLUMN IF NOT EXISTS "linePictureUrl" TEXT;

-- lineUserId のユニーク制約も、まだ無ければ作る
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'User_lineUserId_key'
  ) THEN
    CREATE UNIQUE INDEX "User_lineUserId_key" ON "User"("lineUserId");
  END IF;
END $$;
