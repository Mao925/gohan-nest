import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { FRONTEND_URL, INVITE_TOKEN_TTL_HOURS } from '../config.js';

const communityInvitesRouter = Router();

communityInvitesRouter.use(authMiddleware);

const createInviteBodySchema = z.object({
  communityId: z.string().uuid().optional(),
});

const redeemBodySchema = z.object({
  token: z.string().min(1),
});

communityInvitesRouter.post('/', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  if (!req.user.isAdmin) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const parsed = createInviteBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid request', issues: parsed.error.flatten() });
  }

  try {
    const targetCommunityId = parsed.data.communityId ?? (await getDefaultCommunityId());
    if (!targetCommunityId) {
      return res.status(400).json({ message: 'Community not found' });
    }

    const token = crypto.randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_HOURS * 60 * 60 * 1000);

    const invite = await prisma.communityInvite.create({
      data: {
        token,
        communityId: targetCommunityId,
        createdByUserId: req.user.userId,
        expiresAt,
      },
    });

    const baseUrl = (FRONTEND_URL || 'https://gohan-expo.vercel.app').replace(/\/$/, '');
    const inviteUrl = `${baseUrl}/register?inviteToken=${invite.token}`;
    return res.status(201).json({
      id: invite.id,
      token: invite.token,
      inviteUrl,
    });
  } catch (error) {
    console.error('POST /api/community/invites failed', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

communityInvitesRouter.post('/redeem', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const parsed = redeemBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid request', issues: parsed.error.flatten() });
  }

  const { token } = parsed.data;
  const userId = req.user.userId;

  try {
    const invite = await prisma.communityInvite.findUnique({
      where: { token },
    });

    if (!invite) {
      return res
        .status(404)
        .json({ message: '招待リンクが見つかりません。無効なリンクの可能性があります。' });
    }

    if (invite.usedAt || invite.usedByUserId) {
      return res.status(410).json({ message: 'この招待リンクは既に使用されています。' });
    }

    if (invite.expiresAt && invite.expiresAt < new Date()) {
      return res.status(410).json({ message: 'この招待リンクは有効期限が切れています。' });
    }

    const existingMembership = await prisma.communityMembership.findFirst({
      where: {
        userId,
        communityId: invite.communityId,
      },
    });

    if (existingMembership) {
      if (existingMembership.status === 'approved') {
        return res.status(200).json({
          membershipId: existingMembership.id,
          status: existingMembership.status,
          message: '既にこのコミュニティのメンバーです。',
        });
      }

      const updated = await prisma.communityMembership.update({
        where: { id: existingMembership.id },
        data: {
          status: 'approved',
        },
      });

      await prisma.communityInvite.update({
        where: { id: invite.id },
        data: {
          usedByUserId: userId,
          usedAt: new Date(),
        },
      });

      return res.status(200).json({
        membershipId: updated.id,
        status: updated.status,
        message: 'コミュニティ参加が承認されました。',
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const membership = await tx.communityMembership.create({
        data: {
          userId,
          communityId: invite.communityId,
          status: 'approved',
        },
      });

      await tx.communityInvite.update({
        where: { id: invite.id },
        data: {
          usedByUserId: userId,
          usedAt: new Date(),
        },
      });

      return membership;
    });

    return res.status(201).json({
      membershipId: result.id,
      status: result.status,
      message: '招待リンクからコミュニティに参加しました。',
    });
  } catch (error) {
    console.error('POST /api/community/invites/redeem failed', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

async function getDefaultCommunityId(): Promise<string | null> {
  const community = await prisma.community.findFirst();
  return community?.id ?? null;
}

export { communityInvitesRouter };
