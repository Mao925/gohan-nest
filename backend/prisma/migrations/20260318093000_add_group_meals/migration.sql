-- CreateEnum
CREATE TYPE "GroupMealStatus" AS ENUM ('OPEN', 'FULL', 'CLOSED');

-- CreateEnum
CREATE TYPE "GroupMealParticipantStatus" AS ENUM ('INVITED', 'JOINED', 'DECLINED', 'CANCELLED');

-- CreateTable
CREATE TABLE "GroupMeal" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "title" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "weekday" "Weekday" NOT NULL,
    "timeSlot" "TimeSlot" NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" "GroupMealStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupMeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMealParticipant" (
    "id" TEXT NOT NULL,
    "groupMealId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isHost" BOOLEAN NOT NULL DEFAULT false,
    "status" "GroupMealParticipantStatus" NOT NULL DEFAULT 'INVITED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupMealParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupMealParticipant_groupMealId_userId_key" ON "GroupMealParticipant"("groupMealId", "userId");

-- AddForeignKey
ALTER TABLE "GroupMeal" ADD CONSTRAINT "GroupMeal_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMeal" ADD CONSTRAINT "GroupMeal_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMealParticipant" ADD CONSTRAINT "GroupMealParticipant_groupMealId_fkey" FOREIGN KEY ("groupMealId") REFERENCES "GroupMeal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMealParticipant" ADD CONSTRAINT "GroupMealParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
