import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { buildCommunitySelfStatus, getCommunityStatus } from '../utils/membership.js';

const joinSchema = z
  .object({
    communityName: z.string().min(1),
    joinCode: z.string().length(8).optional(),
    communityCode: z.string().length(8).optional()
  })
  .refine((value) => !!(value.joinCode ?? value.communityCode), {
    path: ['joinCode', 'communityCode'],
    message: 'joinCode is required'
  });

export const communityRouter = Router();

communityRouter.post('/join', authMiddleware, async (req, res) => {
  const parsed = joinSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid invite code', issues: parsed.error.flatten() });
  }

  const joinCode = parsed.data.joinCode ?? parsed.data.communityCode!;
  const community = await prisma.community.findUnique({ where: { inviteCode: joinCode } });
  if (!community) {
    return res.status(404).json({ message: 'Community not found' });
  }
  if (community.name.toLowerCase() !== parsed.data.communityName.trim().toLowerCase()) {
    return res.status(400).json({ message: 'Community name/code mismatch' });
  }

  const nextStatus = 'approved';
  const responseStatus = 'APPROVED';

  await prisma.communityMembership.upsert({
    where: { userId_communityId: { userId: req.user!.userId, communityId: community.id } },
    update: { status: nextStatus },
    create: {
      userId: req.user!.userId,
      communityId: community.id,
      status: nextStatus
    }
  });

  return res.json({ status: responseStatus, communityStatus: responseStatus, communityName: community.name });
});

communityRouter.get('/status', authMiddleware, async (req, res) => {
  const { communityStatus, membership } = await getCommunityStatus(req.user!.userId);
  return res.json({
    status: communityStatus,
    communityName: membership?.status === 'approved' ? membership.community?.name || null : null
  });
});

communityRouter.get('/self-status', authMiddleware, async (req, res) => {
  const status = await buildCommunitySelfStatus(req.user!.userId);
  return res.json(status);
});
