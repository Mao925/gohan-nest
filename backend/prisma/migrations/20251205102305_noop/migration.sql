-- CreateTable
CREATE TABLE "CommunityInvite" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "usedByUserId" TEXT,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommunityInvite_token_key" ON "CommunityInvite"("token");

-- CreateIndex
CREATE INDEX "CommunityInvite_communityId_idx" ON "CommunityInvite"("communityId");

-- AddForeignKey
ALTER TABLE "CommunityInvite" ADD CONSTRAINT "CommunityInvite_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityInvite" ADD CONSTRAINT "CommunityInvite_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityInvite" ADD CONSTRAINT "CommunityInvite_usedByUserId_fkey" FOREIGN KEY ("usedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
