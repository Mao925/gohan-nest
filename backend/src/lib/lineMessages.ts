import { TimeSlot } from '@prisma/client';
import { FRONTEND_URL, LINE_MESSAGING_CHANNEL_ACCESS_TOKEN } from '../config.js';

const LINE_MESSAGING_API_URL = 'https://api.line.me/v2/bot/message/push';

const JP_WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

type TimeSlotString = 'DAY' | 'NIGHT';

function formatJapaneseDateLabel(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekday = JP_WEEKDAYS[date.getDay()];
  return `${month}月${day}日(${weekday})`;
}

function buildAvailabilityTemplate(timeSlot: TimeSlotString) {
  const isLunch = timeSlot === 'DAY';
  const title = isLunch ? '今日の昼ごはんの予定' : '今日の夜ごはんの予定';
  const text = isLunch
    ? '今日の昼ごはんに行けるか教えてください'
    : '今日の夜ごはんに行けるか教えてください';
  const altText = isLunch
    ? '今日の昼ごはんの予定を教えてください'
    : '今日の夜ごはんの予定を教えてください';
  const dataPrefix = `availability:${timeSlot}`;
  return {
    type: 'template',
    altText,
    template: {
      type: 'buttons',
      title,
      text,
      actions: [
        {
          type: 'postback',
          label: '✅ 行ける',
          data: `${dataPrefix}:AVAILABLE`
        },
        {
          type: 'postback',
          label: '❌ 行けない',
          data: `${dataPrefix}:UNAVAILABLE`
        }
      ]
    }
  };
}

export async function pushAvailabilityMessage(
  lineUserId: string,
  timeSlot: TimeSlotString
): Promise<boolean> {
  if (!LINE_MESSAGING_CHANNEL_ACCESS_TOKEN) {
    console.error(
      'LINE_MESSAGING_CHANNEL_ACCESS_TOKEN is not configured for availability pushes'
    );
    return false;
  }

  try {
    const response = await fetch(LINE_MESSAGING_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LINE_MESSAGING_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        to: lineUserId,
        messages: [buildAvailabilityTemplate(timeSlot)]
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('LINE push failed', {
        userId: lineUserId,
        status: response.status,
        body: errorBody
      });
      return false;
    }
    return true;
  } catch (error: any) {
    console.error('LINE push error', { userId: lineUserId, error });
    return false;
  }
}

async function sendLineTextMessage(lineUserId: string, text: string): Promise<void> {
  if (!LINE_MESSAGING_CHANNEL_ACCESS_TOKEN) {
    throw new Error('LINE_MESSAGING_CHANNEL_ACCESS_TOKEN is not configured for pushes');
  }

  const response = await fetch(LINE_MESSAGING_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${LINE_MESSAGING_CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      to: lineUserId,
      messages: [
        {
          type: 'text',
          text
        }
      ]
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`LINE text push failed (${response.status}): ${errorBody}`);
  }
}

export async function pushGroupMealInviteNotification(
  lineUserId: string
): Promise<void> {
  if (!lineUserId) return;

  const text =
    'あなたがみんなでGO飯に招待されたようです🎉\n\n' +
    '今すぐアプリをチェック👀\n' +
    'https://gohan-expo.vercel.app/login';

  await sendLineTextMessage(lineUserId, text);
}

export async function pushNewMatchNotification(
  lineUserId: string
): Promise<void> {
  if (!lineUserId) return;

  const text =
    '誰かとあなたがマッチしたようです✨\n\n' +
    '今すぐアプリで日程調整🗓️\n' +
    'https://gohan-expo.vercel.app/login';

  await sendLineTextMessage(lineUserId, text);
}

export async function pushGroupMealReminderMessage(params: {
  lineUserId: string;
  title: string;
  date: Date | string;
  timeSlot: TimeSlot;
  meetingPlace?: string | null;
}) {
  const { lineUserId, title, date, timeSlot, meetingPlace } = params;
  if (!lineUserId) return;

  const meetingDate = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(meetingDate.getTime())) {
    console.error('[line-reminder] invalid date', { groupMealDate: date });
    return;
  }

  const dateLabel = formatJapaneseDateLabel(meetingDate);
  const timeSlotLabel = timeSlot === 'DAY' ? '昼' : '夜';
  const placeLabel = meetingPlace ?? '（集合場所はアプリで確認してください）';
  const loginUrl =
    (FRONTEND_URL || 'https://gohan-expo.vercel.app').replace(/\/$/, '') + '/login';

  const text =
    `本日のGO飯「${title}」は ${dateLabel} ${timeSlotLabel} に開催予定です🍚\n\n` +
    `集合場所：${placeLabel}\n\n` +
    '詳細はアプリで確認してください👇\n' +
    loginUrl;

  await sendLineTextMessage(lineUserId, text);
}

export { buildAvailabilityTemplate };
