import { GroupMeal, GroupMealParticipant, MealTimeSlot, TimeSlot, User } from '@prisma/client';
import {
  FRONTEND_URL,
  LINE_MESSAGING_CHANNEL_ACCESS_TOKEN
} from '../config.js';

const LINE_PUSH_API_URL = 'https://api.line.me/v2/bot/message/push';
const LOGIN_URL =
  (FRONTEND_URL || 'https://gohan-expo.vercel.app').replace(/\/$/, '') + '/login';

type ParticipantWithUser = GroupMealParticipant & {
  user: User & {
    profile?: {
      name?: string | null;
    } | null;
    lineDisplayName?: string | null;
  };
};

type GroupMealWithParticipants = GroupMeal & {
  participants: ParticipantWithUser[];
};

async function sendLineTemplateMessage(
  lineUserId: string,
  template: {
    type: 'template';
    altText: string;
    template: {
      type: 'buttons';
      text: string;
      actions: Array<Record<string, unknown>>;
    };
  }
) {
  if (!LINE_MESSAGING_CHANNEL_ACCESS_TOKEN) {
    console.warn('[line-group-meal] missing LINE access token; skipping push');
    return;
  }

  try {
    const response = await fetch(LINE_PUSH_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LINE_MESSAGING_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        to: lineUserId,
        messages: [template]
      })
    });

    if (!response.ok) {
      const body = await response.text();
      console.error('[line-group-meal] LINE push failed', {
        status: response.status,
        body
      });
    }
  } catch (error) {
    console.error('[line-group-meal] LINE push error', error);
  }
}

function buildMemberNamesText(meal: GroupMealWithParticipants) {
  const names = meal.participants
    .map((participant) => {
      return (
        participant.user.profile?.name ||
        participant.user.lineDisplayName ||
        'メンバー'
      );
    })
    .map((name) => `${name}さん`);
  if (!names.length) {
    return 'メンバーさん';
  }
  return names.join('、');
}

function buildTimeLabel(meal: GroupMealWithParticipants) {
  if (meal.mealTimeSlot === MealTimeSlot.LUNCH) {
    return '昼12:00';
  }
  if (meal.mealTimeSlot === MealTimeSlot.DINNER) {
    return '夜20:00';
  }
  if (meal.timeSlot === TimeSlot.DAY) {
    return '昼12:00';
  }
  if (meal.timeSlot === TimeSlot.NIGHT) {
    return '夜20:00';
  }
  return 'ご飯の時間';
}

const buildButtonsTemplate = (
  text: string,
  actions: Array<Record<string, unknown>>
): {
  type: 'template';
  altText: string;
  template: {
    type: 'buttons';
    text: string;
    actions: Array<Record<string, unknown>>;
  };
} => ({
  type: 'template',
  altText: text,
  template: {
    type: 'buttons',
    text,
    actions
  }
});

export async function pushRealGroupMealInvite(meal: GroupMealWithParticipants) {
  const memberText = buildMemberNamesText(meal);
  const timeLabel = buildTimeLabel(meal);
  const placeLabel = meal.locationName ?? 'どこか';
  const body =
    `${memberText}と${placeLabel}で${timeLabel}に集合してGO飯に行きませんか？🍚` +
    '\n\n行く🙆\n行かない🙅‍♀️' +
    `\n\n▼他の人の参加状況はこちらから👀\n${LOGIN_URL}`;

  const template = buildButtonsTemplate(body, [
    {
      type: 'postback',
      label: '行く🙆',
      data: JSON.stringify({
        type: 'REAL_GROUP_MEAL_INVITE',
        groupMealId: meal.id,
        action: 'GO'
      })
    },
    {
      type: 'postback',
      label: '行かない🙅‍♀️',
      data: JSON.stringify({
        type: 'REAL_GROUP_MEAL_INVITE',
        groupMealId: meal.id,
        action: 'NOT_GO'
      })
    }
  ]);

  await Promise.all(
    meal.participants.map((participant) => {
      const lineUserId = participant.user.lineUserId;
      if (!lineUserId) {
        return Promise.resolve();
      }
      return sendLineTemplateMessage(lineUserId, template);
    })
  );
}

export async function pushMeetGroupMealInvite(meal: GroupMealWithParticipants) {
  const memberText = buildMemberNamesText(meal);
  const timeLabel = buildTimeLabel(meal);
  const body =
    `${memberText}とMeetで${timeLabel}にGO飯しませんか？🍚` +
    '\n\n参加する✅\n参加しない❎' +
    `\n\n▼当日のリンクはこちらから‼️\n${LOGIN_URL}`;

  const template = buildButtonsTemplate(body, [
    {
      type: 'postback',
      label: '参加する✅',
      data: JSON.stringify({
        type: 'MEET_GROUP_MEAL_INVITE',
        groupMealId: meal.id,
        action: 'GO'
      })
    },
    {
      type: 'postback',
      label: '参加しない❎',
      data: JSON.stringify({
        type: 'MEET_GROUP_MEAL_INVITE',
        groupMealId: meal.id,
        action: 'NOT_GO'
      })
    }
  ]);

  await Promise.all(
    meal.participants.map((participant) => {
      const lineUserId = participant.user.lineUserId;
      if (!lineUserId) {
        return Promise.resolve();
      }
      return sendLineTemplateMessage(lineUserId, template);
    })
  );
}
