import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { DEFAULT_COMMUNITY_CODE } from '../config.js';

const devRouter = Router();
devRouter.use(authMiddleware);

async function getDefaultCommunity() {
  return prisma.community.findUnique({ where: { inviteCode: DEFAULT_COMMUNITY_CODE } });
}

const resetLikeStateSchema = z
  .object({
    resetMembership: z.boolean().optional()
  })
  .default({});

devRouter.post('/approve-me', async (req, res) => {
  const community = await getDefaultCommunity();
  if (!community) {
    return res.status(404).json({ message: 'Community not found' });
  }

  await prisma.communityMembership.upsert({
    where: { userId_communityId: { userId: req.user!.userId, communityId: community.id } },
    update: { status: 'approved' },
    create: { userId: req.user!.userId, communityId: community.id, status: 'approved' }
  });

  res.json({ status: 'APPROVED' });
});

devRouter.post('/reset-status', async (req, res) => {
  const community = await getDefaultCommunity();
  if (!community) {
    return res.status(404).json({ message: 'Community not found' });
  }

  await prisma.communityMembership.deleteMany({ where: { userId: req.user!.userId, communityId: community.id } });
  res.json({ status: 'UNAPPLIED' });
});

devRouter.post('/reset-like-state', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ message: 'Not Found' });
  }

  const parseResult = resetLikeStateSchema.safeParse(req.body ?? {});
  if (!parseResult.success) {
    return res.status(400).json({ message: 'Invalid input', issues: parseResult.error.flatten() });
  }

  const { resetMembership } = parseResult.data;
  const targetUserId = req.user!.userId;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.like.deleteMany({
        where: { fromUserId: targetUserId }
      });

      await tx.match.deleteMany({
        where: {
          OR: [{ user1Id: targetUserId }, { user2Id: targetUserId }]
        }
      });

      if (resetMembership) {
        await tx.communityMembership.deleteMany({
          where: { userId: targetUserId }
        });
      }
    });
  } catch (error) {
    return res.status(500).json({ message: (error as Error).message || 'Failed to reset like state.' });
  }

  return res.status(204).end();
});

export default devRouter;
