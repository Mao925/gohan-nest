-- Add the unified areas column and populate it from the existing main/sub fields
ALTER TABLE "Profile"
ADD COLUMN "areas" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "Profile"
SET "areas" = (
  SELECT ARRAY(
    SELECT DISTINCT value
    FROM unnest(
      array_cat(
        CASE WHEN "mainArea" IS NULL THEN ARRAY[]::TEXT[] ELSE ARRAY["mainArea"] END,
        COALESCE("subAreas", ARRAY[]::TEXT[])
      )
    ) AS value
    WHERE value IS NOT NULL
  )
)
WHERE "areas" IS NULL OR cardinality("areas") = 0;
