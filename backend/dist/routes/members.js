import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { getApprovedMembership } from '../utils/membership.js';
import { buildRelationshipResponse } from '../utils/relationships.js';
export const membersRouter = Router();
membersRouter.use(authMiddleware);
membersRouter.get('/', async (req, res) => {
    const membership = await getApprovedMembership(req.user.userId);
    if (!membership) {
        return res.json([]);
    }
    const members = await prisma.communityMembership.findMany({
        where: { communityId: membership.communityId, status: 'approved' },
        include: { user: { select: { id: true, profile: true } } }
    });
    res.json(members.map((m) => ({
        id: m.user.id,
        name: m.user.profile?.name || '',
        favoriteMeals: m.user.profile?.favoriteMeals || [],
        profileImageUrl: m.user.profile?.profileImageUrl ?? null,
        isSelf: m.user.id === req.user.userId
    })));
});
membersRouter.get('/relationships', async (req, res) => {
    const emptyResponse = {
        matches: [],
        awaitingResponse: [],
        rejected: []
    };
    if (req.user?.isAdmin) {
        // 管理者画面には影響を与えないため空配列を返す
        return res.json(emptyResponse);
    }
    const membership = await getApprovedMembership(req.user.userId);
    if (!membership) {
        return res.json(emptyResponse);
    }
    const userId = req.user.userId;
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
    const reverseLikes = likedUserIds.length === 0
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
    res.json(response);
});
