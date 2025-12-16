-- DropForeignKey
ALTER TABLE "GroupMealChatMessage" DROP CONSTRAINT "GroupMealChatMessage_groupMealId_fkey";

-- DropForeignKey
ALTER TABLE "GroupMealChatMessage" DROP CONSTRAINT "GroupMealChatMessage_senderUserId_fkey";

-- AlterTable
ALTER TABLE "GroupMealChatMessage" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "GroupMealChatMessage" ADD CONSTRAINT "GroupMealChatMessage_groupMealId_fkey" FOREIGN KEY ("groupMealId") REFERENCES "GroupMeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMealChatMessage" ADD CONSTRAINT "GroupMealChatMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
