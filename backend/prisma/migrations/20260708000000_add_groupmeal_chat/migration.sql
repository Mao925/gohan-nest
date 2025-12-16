CREATE TABLE "GroupMealChatMessage" (
  "id" TEXT NOT NULL,
  "groupMealId" TEXT NOT NULL,
  "senderUserId" TEXT NOT NULL,
  "text" VARCHAR(1000) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("id")
);

ALTER TABLE "GroupMealChatMessage"
  ADD CONSTRAINT "GroupMealChatMessage_groupMealId_fkey"
  FOREIGN KEY ("groupMealId")
  REFERENCES "GroupMeal" ("id")
  ON DELETE CASCADE;

ALTER TABLE "GroupMealChatMessage"
  ADD CONSTRAINT "GroupMealChatMessage_senderUserId_fkey"
  FOREIGN KEY ("senderUserId")
  REFERENCES "User" ("id");

CREATE INDEX "GroupMealChatMessage_groupMealId_createdAt_idx"
  ON "GroupMealChatMessage" ("groupMealId", "createdAt");

CREATE INDEX "GroupMealChatMessage_senderUserId_createdAt_idx"
  ON "GroupMealChatMessage" ("senderUserId", "createdAt");
