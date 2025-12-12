-- CreateTable
CREATE TABLE "SuperLike" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuperLike_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SuperLike_fromUserId_communityId_idx" ON "SuperLike"("fromUserId", "communityId");

-- CreateIndex
CREATE UNIQUE INDEX "SuperLike_fromUserId_toUserId_communityId_key" ON "SuperLike"("fromUserId", "toUserId", "communityId");

-- AddForeignKey
ALTER TABLE "SuperLike" ADD CONSTRAINT "SuperLike_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuperLike" ADD CONSTRAINT "SuperLike_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuperLike" ADD CONSTRAINT "SuperLike_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
