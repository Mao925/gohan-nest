-- Add nullable profileImageUrl to profiles for storing a single profile image per user
ALTER TABLE "Profile" ADD COLUMN "profileImageUrl" VARCHAR(500);
