import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { getApprovedMembership } from '../utils/membership.js';

export const matchesRouter = Router();
matchesRouter.use(authMiddleware);

matchesRouter.get('/', async (req, res) => {
  const membership = await getApprovedMembership(req.user!.userId);
  if (!membership) {
    return res.json([]);
  }

  const matches = await prisma.match.findMany({
    where: {
      communityId: membership.communityId,
      OR: [{ user1Id: req.user!.userId }, { user2Id: req.user!.userId }]
    },
    include: {
      user1: { include: { profile: true } },
      user2: { include: { profile: true } }
    }
  });

  const data = matches.map((match) => {
    const isUser1 = match.user1Id === req.user!.userId;
    const partner = isUser1 ? match.user2 : match.user1;
    return {
      id: match.id,
      partnerName: partner.profile?.name || '',
      partnerFavoriteMeals: partner.profile?.favoriteMeals || [],
      profileImageUrl: partner.profile?.profileImageUrl ?? null,
      matchedAt: match.createdAt.toISOString()
    };
  });

  res.json(data);
});
