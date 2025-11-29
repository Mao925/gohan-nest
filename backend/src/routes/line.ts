import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import {
  DEFAULT_COMMUNITY_CODE,
  LINE_MESSAGING_CHANNEL_ACCESS_TOKEN
} from '../config.js';

const lineRouter = Router();

function buildAvailabilityTemplate() {
  return {
    type: 'template',
    altText: '今日のご飯の予定を教えてください',
    template: {
      type: 'buttons',
      title: '今日のご飯の予定',
      text: '今日の昼・夜にご飯に行ける時間帯を教えてください',
      actions: [
        {
          type: 'postback',
          label: '昼ご飯: 空いている',
          data: 'availability:DAY:AVAILABLE'
        },
        {
          type: 'postback',
          label: '昼ご飯: 空いていない',
          data: 'availability:DAY:UNAVAILABLE'
        },
        {
          type: 'postback',
          label: '夜ご飯: 空いている',
          data: 'availability:NIGHT:AVAILABLE'
        },
        {
          type: 'postback',
          label: '夜ご飯: 空いていない',
          data: 'availability:NIGHT:UNAVAILABLE'
        }
      ]
    }
  };
}

lineRouter.post('/daily-availability-push', async (_req, res) => {
  if (!LINE_MESSAGING_CHANNEL_ACCESS_TOKEN) {
    console.error('LINE_MESSAGING_CHANNEL_ACCESS_TOKEN is not configured');
    return res.status(500).json({ message: 'LINE channel access token is not configured' });
  }

  const community = await prisma.community.findUnique({
    where: { inviteCode: DEFAULT_COMMUNITY_CODE }
  });
  if (!community) {
    console.error('KING community not found');
    return res.status(500).json({ message: 'KING community not found' });
  }

  const memberships = await prisma.communityMembership.findMany({
    where: {
      communityId: community.id,
      status: 'approved',
      user: { lineUserId: { not: null } }
    },
    include: { user: { select: { id: true, lineUserId: true } } }
  });

  const payload = buildAvailabilityTemplate();
  let sent = 0;

  for (const membership of memberships) {
    if (!membership.user.lineUserId) {
      continue;
    }

    try {
      const response = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${LINE_MESSAGING_CHANNEL_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          to: membership.user.lineUserId,
          messages: [payload]
        })
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('LINE push failed', {
          userId: membership.user.id,
          status: response.status,
          body: errorBody
        });
        continue;
      }

      sent += 1;
    } catch (error) {
      console.error('LINE push error', { userId: membership.user.id, error });
    }
  }

  return res.json({ sent, target: memberships.length });
});

export { lineRouter };
