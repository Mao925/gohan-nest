import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { adminOnly, authMiddleware } from '../middleware/auth.js';

export const adminRouter = Router();

adminRouter.use(authMiddleware, adminOnly);

adminRouter.get('/join-requests', async (_req, res) => {
  const requests = await prisma.communityMembership.findMany({
    where: { status: 'pending' },
    include: { user: { include: { profile: true } }, community: true },
    orderBy: { createdAt: 'asc' }
  });
  res.json(
    requests.map((request) => ({
      id: request.id,
      name: request.user.profile?.name || '',
      email: request.user.email,
      requestedAt: request.createdAt.toISOString()
    }))
  );
});

adminRouter.post('/join-requests/:id/approve', async (req, res) => {
  const membership = await prisma.communityMembership.update({
    where: { id: req.params.id },
    data: { status: 'approved' }
  });
  res.json({ id: membership.id, status: 'APPROVED' });
});

adminRouter.post('/join-requests/:id/reject', async (req, res) => {
  const membership = await prisma.communityMembership.update({
    where: { id: req.params.id },
    data: { status: 'rejected' }
  });
  res.json({ id: membership.id, status: 'REJECTED' });
});
