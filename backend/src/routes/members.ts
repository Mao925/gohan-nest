import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { getApprovedMembership } from '../utils/membership.js';
import { buildRelationshipResponse, type RelationshipResponse } from '../utils/relationships.js';
import { countUserAvailableSlots, MIN_REQUIRED_AVAILABILITY } from '../utils/availability.js';

type UserAwareRequest = Request & { user?: { userId: string; isAdmin?: boolean } };

export const membersRouter = Router();

membersRouter.use(authMiddleware);

membersRouter.get('/', async (req: UserAwareRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const membership = await getApprovedMembership(userId);
    if (!membership) {
      return res.json({ members: [] });
    }

    const availableCount = await countUserAvailableSlots(userId);
    const meetsAvailabilityRequirement = availableCount >= MIN_REQUIRED_AVAILABILITY;

    const communityMembers = await prisma.communityMembership.findMany({
      where: { communityId: membership.communityId, status: 'approved' },
      include: { user: { select: { id: true, profile: true } } }
    });

    const otherMembers = communityMembers.filter((member) => member.user.id !== userId);
    if (otherMembers.length === 0) {
      return res.json({ members: [] });
    }

    const otherIds = otherMembers.map((member) => member.user.id);
    const [likesFromMe, likesToMe] = await Promise.all([
      prisma.like.findMany({
        where: {
          communityId: membership.communityId,
          fromUserId: userId,
          toUserId: { in: otherIds }
        }
      }),
      prisma.like.findMany({
        where: {
          communityId: membership.communityId,
          fromUserId: { in: otherIds },
          toUserId: userId
        }
      })
    ]);

    const myLikeMap = new Map(likesFromMe.map((like) => [like.toUserId, like]));
    const reverseLikeMap = new Map(likesToMe.map((like) => [like.fromUserId, like]));

    const members = otherMembers.map((member) => {
      const profile = member.user.profile;
      const myLike = myLikeMap.get(member.user.id);
      const partnerLike = reverseLikeMap.get(member.user.id);
      const myLikeStatus = myLike?.answer === 'YES' ? 'YES' : 'NO';
      const isMutualLike = myLikeStatus === 'YES' && partnerLike?.answer === 'YES';

      return {
        id: member.user.id,
        name: profile?.name ?? null,
        favoriteMeals: profile?.favoriteMeals ?? [],
        profileImageUrl: profile?.profileImageUrl ?? null,
        myLikeStatus,
        isMutualLike,
      };
    });

    const safeMembers = meetsAvailabilityRequirement
      ? members
      : members.map((profile) => ({
          ...profile,
          isMutualLike: false
        }));

    return res.json({ members: safeMembers });
  } catch (error) {
    console.error('GET /api/members failed', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

membersRouter.get('/relationships', async (req: UserAwareRequest, res: Response) => {
  const emptyResponse: RelationshipResponse = {
    matches: [],
    awaitingResponse: [],
    rejected: []
  };

  if (req.user?.isAdmin) {
    return res.json(emptyResponse);
  }

  const userId = req.user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const membership = await getApprovedMembership(userId);
    if (!membership) {
      return res.json(emptyResponse);
    }

    const [matches, likesFrom] = await Promise.all([
      prisma.match.findMany({
        where: {
          communityId: membership.communityId,
          OR: [{ user1Id: userId }, { user2Id: userId }]
        },
        include: {
          user1: { include: { profile: true } },
          user2: { include: { profile: true } }
        }
      }),
      prisma.like.findMany({
        where: { fromUserId: userId, communityId: membership.communityId },
        include: { toUser: { include: { profile: true } } }
      })
    ]);

    const likedUserIds = likesFrom.map((like) => like.toUserId);
    const reverseLikes =
      likedUserIds.length === 0
        ? []
        : await prisma.like.findMany({
            where: {
              communityId: membership.communityId,
              fromUserId: { in: likedUserIds },
              toUserId: userId
            }
          });

    const response = buildRelationshipResponse({
      userId,
      matches,
      likesFrom,
      reverseLikes
    });

    return res.json(response);
  } catch (error) {
    console.error('GET /api/members/relationships failed', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});
