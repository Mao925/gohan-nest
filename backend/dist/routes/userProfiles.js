import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { buildProfileResponse } from '../utils/user.js';
const paramsSchema = z.object({
    userId: z.string().uuid()
});
export const userProfilesRouter = Router();
userProfilesRouter.use(authMiddleware);
userProfilesRouter.get('/:userId/profile', async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    const parsed = paramsSchema.safeParse(req.params);
    if (!parsed.success) {
        return res
            .status(400)
            .json({ message: 'Invalid userId', issues: parsed.error.flatten() });
    }
    const targetUserId = parsed.data.userId;
    const viewerId = req.user.userId;
    try {
        const targetMembership = await prisma.communityMembership.findFirst({
            where: {
                userId: targetUserId,
                status: 'approved'
            },
            include: {
                user: {
                    include: {
                        profile: true
                    }
                }
            }
        });
        if (!targetMembership || !targetMembership.user.profile) {
            return res.status(404).json({ message: 'Member not found' });
        }
        const viewerMembership = await prisma.communityMembership.findFirst({
            where: {
                userId: viewerId,
                communityId: targetMembership.communityId,
                status: 'approved'
            }
        });
        if (!viewerMembership) {
            return res.status(404).json({ message: 'Member not found' });
        }
        return res.json(buildProfileResponse(targetMembership.user.profile));
    }
    catch (error) {
        console.error('GET /api/users/:userId/profile failed', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});
