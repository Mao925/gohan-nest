import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { getApprovedMembership } from '../utils/membership.js';
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
        bio: m.user.profile?.bio || '',
        isSelf: m.user.id === req.user.userId
    })));
});
