import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { ensureSameCommunity, getApprovedMembership } from '../utils/membership.js';
import { INCLUDE_SEED_USERS } from '../config.js';
const likeSchema = z.object({
    targetUserId: z.string().uuid(),
    answer: z.enum(['YES', 'NO'])
});
export const likesRouter = Router();
likesRouter.use(authMiddleware);
likesRouter.get('/next-candidate', async (req, res) => {
    const membership = await getApprovedMembership(req.user.userId);
    if (!membership) {
        return res.json({ candidate: null });
    }
    const userWhere = {
        id: { not: req.user.userId },
        memberships: {
            some: { communityId: membership.communityId, status: 'approved' }
        }
    };
    if (!INCLUDE_SEED_USERS) {
        userWhere.profile = { is: { isSeedMember: false } };
    }
    const approvedMembers = await prisma.user.findMany({
        where: userWhere,
        include: { profile: true }
    });
    const existingLikes = await prisma.like.findMany({
        where: { fromUserId: req.user.userId, communityId: membership.communityId },
        select: { toUserId: true }
    });
    const likedSet = new Set(existingLikes.map((l) => l.toUserId));
    const candidates = approvedMembers.filter((member) => !likedSet.has(member.id));
    if (candidates.length === 0) {
        return res.json({ candidate: null });
    }
    const candidate = candidates[Math.floor(Math.random() * candidates.length)];
    return res.json({
        candidate: {
            id: candidate.id,
            name: candidate.profile?.name || '',
            bio: candidate.profile?.bio || ''
        }
    });
});
likesRouter.post('/', async (req, res) => {
    const membership = await getApprovedMembership(req.user.userId);
    if (!membership) {
        return res.status(400).json({
            message: 'コミュニティ参加後にご利用ください。先に参加コードで /api/community/join を呼び出してください。',
            status: 'UNAPPLIED',
            action: 'JOIN_REQUIRED'
        });
    }
    const parsed = likeSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid input', issues: parsed.error.flatten() });
    }
    try {
        await ensureSameCommunity(req.user.userId, parsed.data.targetUserId, membership.communityId);
    }
    catch (error) {
        return res.status(400).json({ message: error.message });
    }
    try {
        const result = await prisma.$transaction(async (tx) => {
            await tx.like.create({
                data: {
                    fromUserId: req.user.userId,
                    toUserId: parsed.data.targetUserId,
                    communityId: membership.communityId,
                    answer: parsed.data.answer
                }
            });
            let matched = false;
            let matchedAt;
            let partnerName = '';
            let partnerBio = '';
            if (parsed.data.answer === 'YES') {
                const reverse = await tx.like.findFirst({
                    where: {
                        fromUserId: parsed.data.targetUserId,
                        toUserId: req.user.userId,
                        communityId: membership.communityId,
                        answer: 'YES'
                    }
                });
                if (reverse) {
                    const [user1Id, user2Id] = [req.user.userId, parsed.data.targetUserId].sort();
                    const matchRecord = await tx.match.upsert({
                        where: {
                            user1Id_user2Id_communityId: {
                                user1Id,
                                user2Id,
                                communityId: membership.communityId
                            }
                        },
                        update: {},
                        create: {
                            user1Id,
                            user2Id,
                            communityId: membership.communityId
                        }
                    });
                    matched = true;
                    matchedAt = matchRecord.createdAt.toISOString();
                    const targetProfile = await tx.profile.findUnique({
                        where: { userId: parsed.data.targetUserId }
                    });
                    partnerName = targetProfile?.name || '';
                    partnerBio = targetProfile?.bio || '';
                }
            }
            return { matched, matchedAt, partnerName, partnerBio };
        });
        if (result.matched) {
            return res.json({
                matched: true,
                matchedAt: result.matchedAt,
                partnerName: result.partnerName,
                partnerBio: result.partnerBio
            });
        }
        return res.json({ matched: false });
    }
    catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return res.status(409).json({ message: 'このユーザーには既に回答済みです' });
        }
        throw error;
    }
});
