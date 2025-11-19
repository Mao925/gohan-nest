-- Add flag to profile for identifying seed users
ALTER TABLE "Profile"
ADD COLUMN "isSeedMember" BOOLEAN NOT NULL DEFAULT false;
