import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import {
  DEFAULT_COMMUNITY_CODE,
  ENABLE_LINE_DAILY_AVAILABILITY_PUSH,
  ENABLE_LINE_GROUPMEAL_REMINDER,
  LINE_MESSAGING_CHANNEL_ACCESS_TOKEN
} from '../config.js';
import {
  pushAvailabilityMessage,
  pushGroupMealReminderMessage
} from '../lib/lineMessages.js';
import {
  GroupMealParticipantStatus,
  GroupMealStatus
} from '@prisma/client';

const lineRouter = Router();

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function sendLunchAvailabilityMessage(lineUserId: string) {
  return pushAvailabilityMessage(lineUserId, 'DAY');
}

lineRouter.post('/daily-availability-push', async (_req, res) => {
  if (!ENABLE_LINE_DAILY_AVAILABILITY_PUSH) {
    console.log(
      '[line-daily-push] disabled via ENABLE_LINE_DAILY_AVAILABILITY_PUSH=false'
    );
    return res.status(204).send();
  }

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

  let sent = 0;

  for (const membership of memberships) {
    if (!membership.user.lineUserId) {
      continue;
    }

    const success = await sendLunchAvailabilityMessage(membership.user.lineUserId);
    if (success) {
      sent += 1;
    }
  }

  return res.json({ sent, target: memberships.length });
});

lineRouter.post('/group-meal-reminders', async (_req, res) => {
  if (!ENABLE_LINE_GROUPMEAL_REMINDER) {
    console.log('[line-group-meal-reminder] disabled');
    return res.status(204).send();
  }

  const today = startOfToday();
  const tomorrow = addDays(today, 1);

  try {
    const groupMeals = await prisma.groupMeal.findMany({
      where: {
        date: { gte: today, lt: tomorrow },
        status: {
          in: [GroupMealStatus.OPEN, GroupMealStatus.FULL]
        }
      },
      include: {
        participants: {
          include: {
            user: true
          }
        }
      }
    });

    for (const gm of groupMeals) {
      for (const participant of gm.participants) {
        if (participant.status === GroupMealParticipantStatus.CANCELLED) {
          continue;
        }

        const lineUserId = participant.user.lineUserId;
        if (!lineUserId) {
          continue;
        }

        try {
          await pushGroupMealReminderMessage({
            lineUserId,
            title: gm.title ?? 'GO飯',
            date: gm.date,
            timeSlot: gm.timeSlot,
            meetingPlace: gm.meetingPlace
          });
        } catch (error: any) {
          console.error('[line-group-meal-reminder] failed', {
            userId: participant.userId,
            groupMealId: gm.id,
            error
          });
        }
      }
    }
  } catch (error: any) {
    console.error('[line-group-meal-reminder] failed to fetch today meals', { error });
  }

  return res.status(204).send();
});

export { lineRouter };
