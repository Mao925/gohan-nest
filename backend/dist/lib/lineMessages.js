import { GroupMealMode } from '@prisma/client';
import { FRONTEND_URL, LINE_MESSAGING_CHANNEL_ACCESS_TOKEN } from '../config.js';
const LINE_MESSAGING_API_URL = 'https://api.line.me/v2/bot/message/push';
const JP_WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
function formatJapaneseDateLabel(date) {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const weekday = JP_WEEKDAYS[date.getDay()];
    return `${month}月${day}日(${weekday})`;
}
function buildAvailabilityTemplate(timeSlot) {
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
                    label: '○（リアル＆Meet可）',
                    data: `${dataPrefix}:AVAILABLE`
                },
                {
                    type: 'postback',
                    label: '✕（参加不可）',
                    data: `${dataPrefix}:UNAVAILABLE`
                },
                {
                    type: 'postback',
                    label: '△（Meetのみ可）',
                    data: `${dataPrefix}:MEET_ONLY`
                }
            ]
        }
    };
}
export async function pushAvailabilityMessage(lineUserId, timeSlot) {
    if (!LINE_MESSAGING_CHANNEL_ACCESS_TOKEN) {
        console.error('LINE_MESSAGING_CHANNEL_ACCESS_TOKEN is not configured for availability pushes');
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
    }
    catch (error) {
        console.error('LINE push error', { userId: lineUserId, error });
        return false;
    }
}
async function sendLineTextMessage(lineUserId, text) {
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
export async function pushGroupMealInviteNotification(params) {
    const { lineUserId, mode, title } = params;
    if (!lineUserId)
        return;
    const baseUrl = (FRONTEND_URL || 'https://gohan-expo.vercel.app').replace(/\/$/, '');
    const loginUrl = `${baseUrl}/login`;
    const inviteTitle = title ?? '';
    let text;
    if (mode === GroupMealMode.REAL) {
        text =
            `招待状：${inviteTitle}\n` +
                'この会に呼ばれた理由は、開けばわかるはず。\n' +
                'メンバーは既に揃っています。あとは、あなたが日程を決めるだけ。\n\n' +
                '▼ログインはこちらから🐥\n' +
                loginUrl;
    }
    else if (mode === GroupMealMode.MEET) {
        text =
            'まだ、一人でYouTube見てるの？\n' +
                '実は今、きみと話したい人がMeetで待ってるみたい！\n\n' +
                '▼ログインはこちらから☃️\n' +
                loginUrl;
    }
    else {
        text =
            `招待状：${inviteTitle}\n` +
                'この会に呼ばれた理由は、開けばわかるはず。\n' +
                'メンバーは既に揃っています。あとは、あなたが日程を決めるだけ。\n\n' +
                '▼ログインはこちらから🐥\n' +
                loginUrl;
    }
    await sendLineTextMessage(lineUserId, text);
}
export async function pushNewMatchNotification(lineUserId) {
    if (!lineUserId)
        return;
    const text = '誰かとあなたがマッチしたようです✨\n\n' +
        '今すぐアプリで日程調整🗓️\n' +
        'https://gohan-expo.vercel.app/login';
    await sendLineTextMessage(lineUserId, text);
}
export async function pushGroupMealReminderMessage(params) {
    const { lineUserId, title, date, timeSlot, meetingPlace } = params;
    if (!lineUserId)
        return;
    const meetingDate = typeof date === 'string' ? new Date(date) : date;
    if (Number.isNaN(meetingDate.getTime())) {
        console.error('[line-reminder] invalid date', { groupMealDate: date });
        return;
    }
    const dateLabel = formatJapaneseDateLabel(meetingDate);
    const timeSlotLabel = timeSlot === 'DAY' ? '昼' : '夜';
    const placeLabel = meetingPlace ?? '（集合場所はアプリで確認してください）';
    const loginUrl = (FRONTEND_URL || 'https://gohan-expo.vercel.app').replace(/\/$/, '') + '/login';
    const text = `本日のGO飯「${title}」は ${dateLabel} ${timeSlotLabel} に開催予定です🍚\n\n` +
        `集合場所：${placeLabel}\n\n` +
        '詳細はアプリで確認してください👇\n' +
        loginUrl;
    await sendLineTextMessage(lineUserId, text);
}
export { buildAvailabilityTemplate };
