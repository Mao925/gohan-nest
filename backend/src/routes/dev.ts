import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { DEFAULT_COMMUNITY_CODE } from '../config.js';

const devRouter = Router();
devRouter.use(authMiddleware);

async function getDefaultCommunity() {
  return prisma.community.findUnique({ where: { inviteCode: DEFAULT_COMMUNITY_CODE } });
}

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
  const community = await getDefaultCommunity();
  if (!community) {
    return res.status(404).json({ message: 'Community not found' });
  }

  await prisma.like.deleteMany({
    where: {
      communityId: community.id,
      OR: [{ fromUserId: req.user!.userId }, { toUserId: req.user!.userId }]
    }
  });

  await prisma.match.deleteMany({
    where: {
      communityId: community.id,
      OR: [{ user1Id: req.user!.userId }, { user2Id: req.user!.userId }]
    }
  });

  res.json({ message: 'Like state reset', status: 'CLEARED' });
});

export default devRouter;
