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
        return res.json({ members: [] });
    }
    const userId = req.user.userId;
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
    res.json({ members });
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
