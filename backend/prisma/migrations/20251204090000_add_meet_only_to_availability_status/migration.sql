-- Add MEET_ONLY to AvailabilityStatus enum (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'AvailabilityStatus'
      AND e.enumlabel = 'MEET_ONLY'
  ) THEN
    ALTER TYPE "AvailabilityStatus" ADD VALUE 'MEET_ONLY';
  END IF;
END$$;