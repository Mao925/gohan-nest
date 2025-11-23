-- Ensure LINE login columns exist; safe to run multiple times.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "lineUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "lineDisplayName" TEXT,
  ADD COLUMN IF NOT EXISTS "linePictureUrl" TEXT;

-- Maintain unique constraint on lineUserId when present.
CREATE UNIQUE INDEX IF NOT EXISTS "User_lineUserId_key" ON "User"("lineUserId");
