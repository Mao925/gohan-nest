import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { getApprovedMembership } from '../utils/membership.js';
import { buildRelationshipResponse, type RelationshipResponse } from '../utils/relationships.js';
import { countUserAvailableSlots, MIN_REQUIRED_AVAILABILITY } from '../utils/availability.js';

export const membersRouter = Router();

membersRouter.use(authMiddleware);

membersRouter.get('/', async (req, res) => {
  if (!req.user) {
    console.warn('GET /api/members called without req.user');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const userId = req.user.userId;

  try {
    const membership = await getApprovedMembership(userId);
    if (!membership) {
      return res.json({ members: [] });
    }

    const availableCount = await countUserAvailableSlots(userId);
    const meetsAvailabilityRequirement = availableCount >= MIN_REQUIRED_AVAILABILITY;

    const memberships = await prisma.communityMembership.findMany({
      where: { communityId: membership.communityId, status: 'approved' },
      include: { user: { select: { id: true, profile: true } } }
    });

    const otherMembers = memberships.filter((m) => m.user.id !== userId);
    if (otherMembers.length === 0) {
      return res.json({ members: [] });
    }

    const memberUserIds = otherMembers.map((member) => member.user.id);
    const [likesFromMe, likesToMe] = await Promise.all([
      prisma.like.findMany({
        where: {
          communityId: membership.communityId,
          fromUserId: userId,
          toUserId: { in: memberUserIds }
        }
      }),
      prisma.like.findMany({
        where: {
          communityId: membership.communityId,
          fromUserId: { in: memberUserIds },
          toUserId: userId
        }
      })
    ]);

    const myLikeMap = new Map(likesFromMe.map((like) => [like.toUserId, like]));
    const reverseLikeMap = new Map(likesToMe.map((like) => [like.fromUserId, like]));

    const members = otherMembers.map((membership) => {
      const profile = membership.user.profile;
      const myLike = myLikeMap.get(membership.user.id);
      const partnerLike = reverseLikeMap.get(membership.user.id);
      const myLikeStatus = myLike?.answer === 'YES' ? 'YES' : 'NO';
      const isMutualLike = myLikeStatus === 'YES' && partnerLike?.answer === 'YES';

      return {
        id: membership.user.id,
        name: profile?.name ?? null,
        favoriteMeals: profile?.favoriteMeals ?? [],
        profileImageUrl: profile?.profileImageUrl ?? null,
        myLikeStatus,
        isMutualLike
      };
    });

    const safeMembers = meetsAvailabilityRequirement
      ? members
      : members.map((member) => ({
          ...member,
          isMutualLike: false
        }));

    return res.json({ members: safeMembers });
  } catch (error) {
    console.error('Unexpected error in GET /api/members', error);
    return res.json({ members: [] as RelationshipResponse[] });
  }
});

membersRouter.get('/relationships', async (req, res) => {
  const emptyResponse: RelationshipResponse = {
    matches: [],
    awaitingResponse: [],
    rejected: []
  };

  if (req.user?.isAdmin) {
    return res.json(emptyResponse);
  }

  const membership = await getApprovedMembership(req.user!.userId);
  if (!membership) {
    return res.json(emptyResponse);
  }

  const userId = req.user!.userId;

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
});
