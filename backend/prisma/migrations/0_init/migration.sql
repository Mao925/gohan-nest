-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "LikeAnswer" AS ENUM ('YES', 'NO');

-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN');

-- CreateEnum
CREATE TYPE "TimeSlot" AS ENUM ('DAY', 'NIGHT');

-- CreateEnum
CREATE TYPE "ScheduleTimeBand" AS ENUM ('LUNCH', 'DINNER');

-- CreateEnum
CREATE TYPE "PairMealStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AvailabilityStatus" AS ENUM ('AVAILABLE', 'UNAVAILABLE', 'MEET_ONLY');

-- CreateEnum
CREATE TYPE "GroupMealStatus" AS ENUM ('OPEN', 'FULL', 'CLOSED');

-- CreateEnum
CREATE TYPE "GroupMealBudget" AS ENUM ('UNDER_1000', 'UNDER_1500', 'UNDER_2000', 'OVER_2000');

-- CreateEnum
CREATE TYPE "DrinkingStyle" AS ENUM ('NO_ALCOHOL', 'SOMETIMES', 'ENJOY_DRINKING');

-- CreateEnum
CREATE TYPE "MealStyle" AS ENUM ('TALK_DEEP', 'CASUAL_CHAT', 'BRAINSTORM');

-- CreateEnum
CREATE TYPE "GoMealFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "GroupMealParticipantStatus" AS ENUM ('INVITED', 'JOINED', 'DECLINED', 'CANCELLED', 'LATE');

-- CreateEnum
CREATE TYPE "GroupMealMode" AS ENUM ('REAL', 'MEET');

-- CreateEnum
CREATE TYPE "MealTimeSlot" AS ENUM ('LUNCH', 'DINNER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lineUserId" TEXT,
    "lineDisplayName" TEXT,
    "linePictureUrl" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isSeedMember" BOOLEAN,
    "favoriteMeals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "profileImageUrl" TEXT,
    "mainArea" TEXT,
    "subAreas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    areas TEXT[] DEFAULT '{}',
    "defaultBudget" "GroupMealBudget",
    "drinkingStyle" "DrinkingStyle",
    "ngFoods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bio" TEXT,
    "mealStyle" "MealStyle",
    "goMealFrequency" "GoMealFrequency",
    "hobbies" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Community" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Community_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Like" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "answer" "LikeAnswer" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Like_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "user1Id" TEXT NOT NULL,
    "user2Id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PairMeal" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "memberAId" TEXT NOT NULL,
    "memberBId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "timeBand" "ScheduleTimeBand" NOT NULL,
    "meetingTimeMinutes" INTEGER,
    "placeName" TEXT,
    "placeAddress" TEXT,
    "placeLatitude" DOUBLE PRECISION,
    "placeLongitude" DOUBLE PRECISION,
    "placeGooglePlaceId" TEXT,
    "restaurantName" TEXT,
    "restaurantAddress" TEXT,
    "status" "PairMealStatus" NOT NULL DEFAULT 'CONFIRMED',
    "createdByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PairMeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilitySlot" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "weekday" "Weekday" NOT NULL,
    "timeSlot" "TimeSlot" NOT NULL,
    "status" "AvailabilityStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvailabilitySlot_pkey" PRIMARY KEY ("id")
);

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
    "budget" "GroupMealBudget",
    "meetingPlace" VARCHAR(255),
    "hostMembershipId" TEXT,
    "meetingTimeMinutes" INTEGER,
    "placeAddress" TEXT,
    "placeGooglePlaceId" TEXT,
    "placeLatitude" DOUBLE PRECISION,
    "placeLongitude" DOUBLE PRECISION,
    "placeName" TEXT,
    "mode" "GroupMealMode" NOT NULL DEFAULT 'REAL',
    "mealTimeSlot" "MealTimeSlot",
    "locationName" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "meetUrl" TEXT,
    "talkTopics" TEXT[],
    "createdById" TEXT,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "GroupMeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMealCandidate" (
    "id" TEXT NOT NULL,
    "groupMealId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isCanceled" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),
    "firstOpenedAt" TIMESTAMP(3),
    "lastOpenedAt" TIMESTAMP(3),

    CONSTRAINT "GroupMealCandidate_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_lineUserId_key" ON "User"("lineUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Community_inviteCode_key" ON "Community"("inviteCode");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityMembership_userId_communityId_key" ON "CommunityMembership"("userId", "communityId");

-- CreateIndex
CREATE UNIQUE INDEX "Like_fromUserId_toUserId_communityId_key" ON "Like"("fromUserId", "toUserId", "communityId");

-- CreateIndex
CREATE UNIQUE INDEX "Match_user1Id_user2Id_communityId_key" ON "Match"("user1Id", "user2Id", "communityId");

-- CreateIndex
CREATE UNIQUE INDEX "AvailabilitySlot_userId_weekday_timeSlot_key" ON "AvailabilitySlot"("userId", "weekday", "timeSlot");

-- CreateIndex
CREATE INDEX "GroupMealCandidate_groupMealId_idx" ON "GroupMealCandidate"("groupMealId");

-- CreateIndex
CREATE INDEX "GroupMealCandidate_userId_idx" ON "GroupMealCandidate"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMealCandidate_groupMealId_userId_key" ON "GroupMealCandidate"("groupMealId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMealParticipant_groupMealId_userId_key" ON "GroupMealParticipant"("groupMealId", "userId");

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMembership" ADD CONSTRAINT "CommunityMembership_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMembership" ADD CONSTRAINT "CommunityMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Like" ADD CONSTRAINT "Like_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Like" ADD CONSTRAINT "Like_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Like" ADD CONSTRAINT "Like_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_user1Id_fkey" FOREIGN KEY ("user1Id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_user2Id_fkey" FOREIGN KEY ("user2Id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PairMeal" ADD CONSTRAINT "PairMeal_createdByMemberId_fkey" FOREIGN KEY ("createdByMemberId") REFERENCES "CommunityMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PairMeal" ADD CONSTRAINT "PairMeal_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PairMeal" ADD CONSTRAINT "PairMeal_memberAId_fkey" FOREIGN KEY ("memberAId") REFERENCES "CommunityMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PairMeal" ADD CONSTRAINT "PairMeal_memberBId_fkey" FOREIGN KEY ("memberBId") REFERENCES "CommunityMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilitySlot" ADD CONSTRAINT "AvailabilitySlot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMeal" ADD CONSTRAINT "GroupMeal_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMeal" ADD CONSTRAINT "GroupMeal_hostMembershipId_fkey" FOREIGN KEY ("hostMembershipId") REFERENCES "CommunityMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMeal" ADD CONSTRAINT "GroupMeal_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMealCandidate" ADD CONSTRAINT "GroupMealCandidate_groupMealId_fkey" FOREIGN KEY ("groupMealId") REFERENCES "GroupMeal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMealCandidate" ADD CONSTRAINT "GroupMealCandidate_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMealCandidate" ADD CONSTRAINT "GroupMealCandidate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMealParticipant" ADD CONSTRAINT "GroupMealParticipant_groupMealId_fkey" FOREIGN KEY ("groupMealId") REFERENCES "GroupMeal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMealParticipant" ADD CONSTRAINT "GroupMealParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

