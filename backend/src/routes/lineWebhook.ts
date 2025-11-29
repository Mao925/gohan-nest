import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { AvailabilityStatus, TimeSlot } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import {
  LINE_MESSAGING_CHANNEL_ACCESS_TOKEN,
  LINE_MESSAGING_CHANNEL_SECRET
} from '../config.js';
import { getTodayWeekdayInJst } from '../utils/date.js';

type RawBodyRequest = Request & { rawBody?: Buffer };

const lineWebhookRouter = Router();

function verifySignature(signature: string | undefined, rawBody: Buffer | undefined) {
  if (!signature || !LINE_MESSAGING_CHANNEL_SECRET || !rawBody) {
    console.warn('verifySignature: missing param', {
      hasSignature: Boolean(signature),
      hasSecret: Boolean(LINE_MESSAGING_CHANNEL_SECRET),
      hasRawBody: Boolean(rawBody),
    });
    return false;
  }
  const hash = crypto
    .createHmac('sha256', LINE_MESSAGING_CHANNEL_SECRET)
    .update(rawBody)
    .digest('base64');
  console.log('verifySignature debug', {
    signatureFromHeader: signature,
    generatedHash: hash,
    equal: hash === signature,
  });
  return hash === signature;
}

async function replyToLine(replyToken: string, text: string) {
  if (!LINE_MESSAGING_CHANNEL_ACCESS_TOKEN) {
    console.error('LINE_MESSAGING_CHANNEL_ACCESS_TOKEN is not configured for replies');
    return;
  }

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LINE_MESSAGING_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        replyToken,
        messages: [{ type: 'text', text }]
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('LINE reply failed', {
        status: response.status,
        body: errorBody
      });
    }
  } catch (error) {
    console.error('LINE reply error', error);
  }
}

lineWebhookRouter.post('/', async (req, res) => {
  const rawBody = (req as RawBodyRequest).rawBody;
  const signature = req.header('x-line-signature');

  console.log('LINE webhook incoming', {
    rawBodyLength: rawBody?.length ?? 0,
    signature,
  });

  if (!verifySignature(signature, rawBody)) {
    console.warn('Invalid LINE signature');
    return res.sendStatus(403);
  }

  const events = Array.isArray(req.body?.events) ? req.body.events : [];

  for (const event of events) {
    if (event.type !== 'postback') {
      continue;
    }

    const postbackData = event.postback?.data ?? '';
    const [prefix, timeSlotRaw, statusRaw] = postbackData.split(':');
    if (prefix !== 'availability') {
      continue;
    }

    if (
      !['DAY', 'NIGHT'].includes(timeSlotRaw) ||
      !['AVAILABLE', 'UNAVAILABLE'].includes(statusRaw)
    ) {
      continue;
    }

    const userLineId = event.source?.userId;
    const replyToken = event.replyToken;
    if (!userLineId || !replyToken) {
      continue;
    }

    const user = await prisma.user.findUnique({
      where: { lineUserId: userLineId },
      select: { id: true }
    });
    if (!user) {
      continue;
    }

    const weekday = getTodayWeekdayInJst();
    const timeSlot = timeSlotRaw as TimeSlot;
    const status = statusRaw as AvailabilityStatus;

    try {
      await prisma.availabilitySlot.upsert({
        where: { userId_weekday_timeSlot: { userId: user.id, weekday, timeSlot } },
        create: { userId: user.id, weekday, timeSlot, status },
        update: { status }
      });

      const slotLabel = timeSlot === TimeSlot.DAY ? '昼ごはん' : '夜ごはん';
      const statusLabel =
        status === AvailabilityStatus.AVAILABLE ? '空いている' : '空いていない';
      await replyToLine(replyToken, `今日の${slotLabel}: ${statusLabel} を登録しました`);
    } catch (error) {
      console.error('Failed to upsert availability from LINE', { error });
      await replyToLine(
        replyToken,
        '今日の予定を記録できませんでした。あとでもう一度試してください'
      );
    }
  }

  return res.sendStatus(200);
});

export { lineWebhookRouter };
