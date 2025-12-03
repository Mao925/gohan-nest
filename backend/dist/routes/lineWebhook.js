import crypto from 'node:crypto';
import { Router } from 'express';
import { AvailabilityStatus, GroupMealParticipantStatus, TimeSlot } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { LINE_MESSAGING_CHANNEL_ACCESS_TOKEN, LINE_MESSAGING_CHANNEL_SECRET } from '../config.js';
import { getTodayWeekdayInJst } from '../utils/date.js';
import { pushAvailabilityMessage } from '../lib/lineMessages.js';
const lineWebhookRouter = Router();
function verifySignature(signature, rawBody) {
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
async function replyToLine(replyToken, text) {
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
    }
    catch (error) {
        console.error('LINE reply error', error);
    }
}
async function sendDinnerAvailabilityMessage(lineUserId) {
    await pushAvailabilityMessage(lineUserId, 'NIGHT');
}
lineWebhookRouter.post('/', async (req, res) => {
    const rawBody = req.rawBody;
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
        if (postbackData.startsWith('availability:')) {
            const [, timeSlotRaw, statusRaw] = postbackData.split(':');
            if (!['DAY', 'NIGHT'].includes(timeSlotRaw) ||
                !['AVAILABLE', 'UNAVAILABLE', 'MEET_ONLY'].includes(statusRaw)) {
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
            const timeSlot = timeSlotRaw;
            const status = statusRaw;
            try {
                await prisma.availabilitySlot.upsert({
                    where: { userId_weekday_timeSlot: { userId: user.id, weekday, timeSlot } },
                    create: { userId: user.id, weekday, timeSlot, status },
                    update: { status }
                });
                const slotLabel = timeSlot === TimeSlot.DAY ? '昼ごはん' : '夜ごはん';
                const statusLabel = status === AvailabilityStatus.AVAILABLE
                    ? '空いている'
                    : status === AvailabilityStatus.MEET_ONLY
                        ? 'Meetのみ'
                        : '空いていない';
                await replyToLine(replyToken, `今日の${slotLabel}: ${statusLabel} を登録しました`);
                if (timeSlot === TimeSlot.DAY) {
                    await sendDinnerAvailabilityMessage(userLineId);
                }
            }
            catch (error) {
                console.error('Failed to upsert availability from LINE', { error });
                await replyToLine(replyToken, '今日の予定を記録できませんでした。あとでもう一度試してください');
            }
            continue;
        }
        let payload = null;
        try {
            payload = JSON.parse(postbackData);
        }
        catch {
            payload = null;
        }
        if (payload?.type === 'REAL_GROUP_MEAL_INVITE' ||
            payload?.type === 'MEET_GROUP_MEAL_INVITE') {
            const { groupMealId, action } = payload;
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
            const participant = await prisma.groupMealParticipant.findFirst({
                where: {
                    groupMealId,
                    userId: user.id
                }
            });
            if (!participant) {
                continue;
            }
            const newStatus = action === 'GO'
                ? GroupMealParticipantStatus.GO
                : action === 'NOT_GO'
                    ? GroupMealParticipantStatus.NOT_GO
                    : GroupMealParticipantStatus.PENDING;
            if (newStatus !== participant.status) {
                await prisma.groupMealParticipant.update({
                    where: { id: participant.id },
                    data: { status: newStatus }
                });
            }
            const replyText = newStatus === GroupMealParticipantStatus.GO
                ? '参加ステータスを「行く」に更新しました！'
                : newStatus === GroupMealParticipantStatus.NOT_GO
                    ? '参加ステータスを「行かない」に更新しました。'
                    : '参加ステータスを更新しました。';
            await replyToLine(replyToken, replyText);
            continue;
        }
    }
    return res.sendStatus(200);
});
export { lineWebhookRouter };
