-- Track whether a participant record represents the creator to count them toward capacity when appropriate
ALTER TABLE "GroupMealParticipant"
  ADD COLUMN "isCreator" boolean NOT NULL DEFAULT false;
