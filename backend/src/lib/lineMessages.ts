import { LINE_MESSAGING_CHANNEL_ACCESS_TOKEN } from '../config.js';

type TimeSlotString = 'DAY' | 'NIGHT';

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
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
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
  } catch (error) {
    console.error('LINE push error', { userId: lineUserId, error });
    return false;
  }
}

export { buildAvailabilityTemplate };
