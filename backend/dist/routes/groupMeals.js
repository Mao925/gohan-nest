import { Router } from 'express';
import { z } from 'zod';
import { AvailabilityStatus, GroupMealParticipantStatus, GroupMealStatus, TimeSlot } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { getApprovedMembership } from '../utils/membership.js';
const createGroupMealSchema = z.object({
    title: z.string().trim().max(100).optional(),
    date: z.string().datetime(),
    timeSlot: z.nativeEnum(TimeSlot),
    capacity: z.number().int().min(3).max(10)
});
const inviteSchema = z.object({
    userIds: z.array(z.string().uuid()).min(1)
});
const respondSchema = z.object({
    action: z.enum(['ACCEPT', 'DECLINE'])
});
const idParamSchema = z.object({
    id: z.string().uuid()
});
const membershipRequiredResponse = {
    message: 'コミュニティ参加後にご利用ください。先に参加コードで /api/community/join を呼び出してください。',
    status: 'UNAPPLIED',
    action: 'JOIN_REQUIRED'
};
const participantInclude = { user: { include: { profile: true } } };
const groupMealInclude = {
    participants: { include: participantInclude },
    host: { include: { profile: true } }
};
const ACTIVE_PARTICIPANT_STATUSES = [
    GroupMealParticipantStatus.INVITED,
    GroupMealParticipantStatus.JOINED
];
const WEEKDAY_FROM_UTCDAY = [
    'SUN',
    'MON',
    'TUE',
    'WED',
    'THU',
    'FRI',
    'SAT'
];
function getWeekdayFromDate(date) {
    return WEEKDAY_FROM_UTCDAY[date.getUTCDay()];
}
function isActiveParticipant(status) {
    return ACTIVE_PARTICIPANT_STATUSES.includes(status);
}
function buildParticipantPayload(participant) {
    return {
        userId: participant.userId,
        isHost: participant.isHost,
        status: participant.status,
        name: participant.user.profile?.name || '',
        favoriteMeals: participant.user.profile?.favoriteMeals || []
    };
}
function getMyStatus(participants, userId) {
    const me = participants.find((p) => p.userId === userId);
    if (!me)
        return 'NONE';
    if (me.status === GroupMealParticipantStatus.JOINED)
        return 'JOINED';
    if (me.status === GroupMealParticipantStatus.INVITED)
        return 'INVITED';
    return 'NONE';
}
function buildGroupMealPayload(groupMeal, currentUserId, opts = {}) {
    const joinedCount = groupMeal.participants.filter((p) => p.status === GroupMealParticipantStatus.JOINED).length;
    const participants = (opts.joinedOnly
        ? groupMeal.participants.filter((p) => p.status === GroupMealParticipantStatus.JOINED)
        : groupMeal.participants).map(buildParticipantPayload);
    return {
        id: groupMeal.id,
        title: groupMeal.title,
        date: groupMeal.date.toISOString(),
        weekday: groupMeal.weekday,
        timeSlot: groupMeal.timeSlot,
        capacity: groupMeal.capacity,
        status: groupMeal.status,
        host: {
            userId: groupMeal.hostUserId,
            name: groupMeal.host.profile?.name || ''
        },
        joinedCount,
        remainingSlots: Math.max(groupMeal.capacity - joinedCount, 0),
        myStatus: currentUserId ? getMyStatus(groupMeal.participants, currentUserId) : undefined,
        participants
    };
}
async function fetchGroupMeal(id) {
    return prisma.groupMeal.findUnique({
        where: { id },
        include: groupMealInclude
    });
}
async function syncGroupMealStatus(db, groupMealId, capacity, currentStatus) {
    if (currentStatus === GroupMealStatus.CLOSED) {
        return currentStatus;
    }
    const activeCount = await db.groupMealParticipant.count({
        where: {
            groupMealId,
            status: { in: ACTIVE_PARTICIPANT_STATUSES }
        }
    });
    const nextStatus = activeCount >= capacity ? GroupMealStatus.FULL : GroupMealStatus.OPEN;
    if (nextStatus !== currentStatus) {
        await db.groupMeal.update({ where: { id: groupMealId }, data: { status: nextStatus } });
    }
    return nextStatus;
}
export const groupMealsRouter = Router();
groupMealsRouter.use(authMiddleware);
// admin ユーザーには一覧/詳細/削除のみ許可し、それ以外は弾く。一般ユーザーは全機能利用可。
groupMealsRouter.use((req, res, next) => {
    if (!req.user?.isAdmin) {
        return next();
    }
    const isListRequest = req.method === 'GET' && (req.path === '/' || req.path === '');
    const isDetailRequest = req.method === 'GET' && /^\/[0-9a-fA-F-]+$/.test(req.path);
    const isDeleteRequest = req.method === 'DELETE';
    if (isListRequest || isDetailRequest || isDeleteRequest) {
        return next();
    }
    return res.status(403).json({ message: '一般ユーザーのみ利用できます' });
});
groupMealsRouter.post('/', async (req, res) => {
    const membership = await getApprovedMembership(req.user.userId);
    if (!membership) {
        return res.status(400).json(membershipRequiredResponse);
    }
    const parsed = createGroupMealSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid input', issues: parsed.error.flatten() });
    }
    const date = new Date(parsed.data.date);
    if (Number.isNaN(date.getTime())) {
        return res.status(400).json({ message: 'Invalid date' });
    }
    const weekday = getWeekdayFromDate(date);
    try {
        const groupMeal = await prisma.groupMeal.create({
            data: {
                communityId: membership.communityId,
                hostUserId: req.user.userId,
                title: parsed.data.title,
                date,
                weekday,
                timeSlot: parsed.data.timeSlot,
                capacity: parsed.data.capacity,
                participants: {
                    create: {
                        userId: req.user.userId,
                        isHost: true,
                        status: GroupMealParticipantStatus.JOINED
                    }
                }
            },
            include: groupMealInclude
        });
        return res.status(201).json(buildGroupMealPayload(groupMeal, req.user.userId));
    }
    catch (error) {
        console.error('CREATE GROUP MEAL ERROR:', error);
        return res.status(500).json({ message: 'Failed to create group meal' });
    }
});
groupMealsRouter.get('/', async (req, res) => {
    const membership = req.user?.isAdmin ? null : await getApprovedMembership(req.user.userId);
    if (!membership && !req.user?.isAdmin) {
        return res.status(400).json(membershipRequiredResponse);
    }
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    today.setUTCDate(today.getUTCDate() - 1); // include recent past a little
    try {
        const groupMeals = await prisma.groupMeal.findMany({
            where: {
                ...(membership ? { communityId: membership.communityId } : {}),
                status: { in: [GroupMealStatus.OPEN, GroupMealStatus.FULL] },
                date: { gte: today }
            },
            include: groupMealInclude,
            orderBy: [{ date: 'asc' }, { createdAt: 'asc' }]
        });
        return res.json(groupMeals.map((gm) => buildGroupMealPayload(gm, req.user.userId, { joinedOnly: true })));
    }
    catch (error) {
        console.error('LIST GROUP MEALS ERROR:', error);
        return res.status(500).json({ message: 'Failed to fetch group meals' });
    }
});
groupMealsRouter.get('/:id', async (req, res) => {
    const parsedParams = idParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
        return res
            .status(400)
            .json({ message: 'Invalid group meal id', issues: parsedParams.error.flatten() });
    }
    const groupMealId = parsedParams.data.id;
    // admin 以外は membership 必須
    const membership = req.user?.isAdmin ? null : await getApprovedMembership(req.user.userId);
    if (!membership && !req.user?.isAdmin) {
        return res.status(400).json(membershipRequiredResponse);
    }
    try {
        const groupMeal = await prisma.groupMeal.findUnique({
            where: { id: groupMealId },
            include: groupMealInclude
        });
        if (!groupMeal) {
            return res.status(404).json({ message: 'Group meal not found' });
        }
        // 一般ユーザーの場合は、同じコミュニティの箱のみ閲覧可能
        if (!req.user?.isAdmin && membership && groupMeal.communityId !== membership.communityId) {
            return res.status(403).json({ message: '別のコミュニティの募集です' });
        }
        return res.json(buildGroupMealPayload(groupMeal, req.user.userId));
    }
    catch (error) {
        console.error('GET GROUP MEAL DETAIL ERROR:', error);
        return res.status(500).json({ message: 'Failed to fetch group meal detail' });
    }
});
groupMealsRouter.delete('/:id', async (req, res) => {
    const parsedParams = idParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
        return res
            .status(400)
            .json({ message: 'Invalid group meal id', issues: parsedParams.error.flatten() });
    }
    const groupMealId = parsedParams.data.id;
    const groupMeal = await prisma.groupMeal.findUnique({
        where: { id: groupMealId },
        include: { participants: true }
    });
    if (!groupMeal) {
        return res.status(404).json({ message: 'Group meal not found' });
    }
    const isAdmin = req.user?.isAdmin;
    const isHost = groupMeal.hostUserId === req.user.userId;
    if (!isAdmin && !isHost) {
        return res.status(403).json({ message: '削除できるのはホストまたは管理者のみです' });
    }
    try {
        await prisma.$transaction(async (tx) => {
            await tx.groupMealParticipant.deleteMany({
                where: { groupMealId: groupMeal.id }
            });
            await tx.groupMeal.delete({
                where: { id: groupMeal.id }
            });
        });
        return res.status(204).send();
    }
    catch (error) {
        console.error('DELETE GROUP MEAL ERROR:', error);
        return res.status(500).json({ message: 'Failed to delete group meal' });
    }
});
groupMealsRouter.get('/:id/candidates', async (req, res) => {
    const membership = await getApprovedMembership(req.user.userId);
    if (!membership) {
        return res.status(400).json(membershipRequiredResponse);
    }
    const parsedParams = idParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
        return res.status(400).json({ message: 'Invalid group meal id', issues: parsedParams.error.flatten() });
    }
    const groupMealId = parsedParams.data.id;
    const groupMeal = await prisma.groupMeal.findUnique({
        where: { id: groupMealId },
        include: { participants: true }
    });
    if (!groupMeal) {
        return res.status(404).json({ message: 'Group meal not found' });
    }
    if (groupMeal.hostUserId !== req.user.userId) {
        return res.status(403).json({ message: '招待候補を取得できるのはホストのみです' });
    }
    if (groupMeal.communityId !== membership.communityId) {
        return res.status(403).json({ message: '別のコミュニティの募集です' });
    }
    const participantIds = new Set(groupMeal.participants.map((p) => p.userId));
    try {
        const baseCandidates = await prisma.user.findMany({
            where: {
                isAdmin: false,
                id: { notIn: Array.from(participantIds) },
                memberships: {
                    some: { communityId: groupMeal.communityId, status: 'approved' }
                }
            },
            include: { profile: true }
        });
        if (baseCandidates.length === 0) {
            return res.json({ candidates: [] });
        }
        const availableSlots = await prisma.availabilitySlot.findMany({
            where: {
                userId: { in: baseCandidates.map((c) => c.id) },
                weekday: groupMeal.weekday,
                timeSlot: groupMeal.timeSlot,
                status: AvailabilityStatus.AVAILABLE
            },
            select: { userId: true }
        });
        const availableUserIds = new Set(availableSlots.map((s) => s.userId));
        const candidates = baseCandidates
            .map((u) => ({
            userId: u.id,
            name: u.profile?.name ?? '未設定',
            favoriteMeals: u.profile?.favoriteMeals || [],
            isAvailableForSlot: availableUserIds.has(u.id)
        }))
            .sort((a, b) => Number(b.isAvailableForSlot) - Number(a.isAvailableForSlot));
        return res.json({ candidates });
    }
    catch (error) {
        console.error('FETCH GROUP MEAL CANDIDATES ERROR:', error);
        return res.status(500).json({ message: 'Failed to fetch candidates' });
    }
});
groupMealsRouter.post('/:id/invite', async (req, res) => {
    const membership = await getApprovedMembership(req.user.userId);
    if (!membership) {
        return res.status(400).json(membershipRequiredResponse);
    }
    const parsedParams = idParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
        return res.status(400).json({ message: 'Invalid group meal id', issues: parsedParams.error.flatten() });
    }
    const groupMealId = parsedParams.data.id;
    const parsedBody = inviteSchema.safeParse(req.body);
    if (!parsedBody.success) {
        return res.status(400).json({ message: 'Invalid input', issues: parsedBody.error.flatten() });
    }
    const uniqueUserIds = Array.from(new Set(parsedBody.data.userIds));
    const groupMeal = await prisma.groupMeal.findUnique({
        where: { id: groupMealId },
        include: { participants: true }
    });
    if (!groupMeal) {
        return res.status(404).json({ message: 'Group meal not found' });
    }
    if (groupMeal.hostUserId !== req.user.userId) {
        return res.status(403).json({ message: '招待できるのはホストのみです' });
    }
    if (groupMeal.communityId !== membership.communityId) {
        return res.status(403).json({ message: '別のコミュニティの募集です' });
    }
    if (uniqueUserIds.includes(req.user.userId)) {
        return res.status(400).json({ message: 'ホスト自身は招待できません' });
    }
    const existingActiveIds = new Set(groupMeal.participants
        .filter((p) => isActiveParticipant(p.status))
        .map((p) => p.userId));
    const newInviteCount = uniqueUserIds.filter((id) => !existingActiveIds.has(id)).length;
    const activeCount = existingActiveIds.size;
    if (activeCount + newInviteCount > groupMeal.capacity) {
        return res.status(400).json({ message: '定員を超えるため招待できません' });
    }
    const validUsers = await prisma.user.findMany({
        where: {
            id: { in: uniqueUserIds },
            isAdmin: false,
            memberships: {
                some: { communityId: groupMeal.communityId, status: 'approved' }
            }
        },
        select: { id: true }
    });
    const validUserIdSet = new Set(validUsers.map((u) => u.id));
    const invalidId = uniqueUserIds.find((id) => !validUserIdSet.has(id));
    if (invalidId) {
        return res
            .status(400)
            .json({ message: '招待できないユーザーが含まれています', userId: invalidId });
    }
    try {
        await prisma.$transaction(async (tx) => {
            for (const userId of uniqueUserIds) {
                await tx.groupMealParticipant.upsert({
                    where: { groupMealId_userId: { groupMealId, userId } },
                    update: {
                        status: GroupMealParticipantStatus.INVITED,
                        isHost: false
                    },
                    create: {
                        groupMealId,
                        userId,
                        isHost: false,
                        status: GroupMealParticipantStatus.INVITED
                    }
                });
            }
            await syncGroupMealStatus(tx, groupMealId, groupMeal.capacity, groupMeal.status);
        });
        const updated = await fetchGroupMeal(groupMealId);
        return res.json(buildGroupMealPayload(updated, req.user.userId));
    }
    catch (error) {
        console.error('INVITE GROUP MEAL CANDIDATES ERROR:', error);
        return res.status(500).json({ message: 'Failed to invite candidates' });
    }
});
groupMealsRouter.post('/:id/respond', async (req, res) => {
    const membership = await getApprovedMembership(req.user.userId);
    if (!membership) {
        return res.status(400).json(membershipRequiredResponse);
    }
    const parsedParams = idParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
        return res.status(400).json({ message: 'Invalid group meal id', issues: parsedParams.error.flatten() });
    }
    const groupMealId = parsedParams.data.id;
    const parsedBody = respondSchema.safeParse(req.body);
    if (!parsedBody.success) {
        return res.status(400).json({ message: 'Invalid input', issues: parsedBody.error.flatten() });
    }
    const groupMeal = await prisma.groupMeal.findUnique({
        where: { id: groupMealId },
        include: { participants: true }
    });
    if (!groupMeal) {
        return res.status(404).json({ message: 'Group meal not found' });
    }
    if (groupMeal.communityId !== membership.communityId) {
        return res.status(403).json({ message: '別のコミュニティの募集です' });
    }
    const participant = groupMeal.participants.find((p) => p.userId === req.user.userId);
    const activeCount = groupMeal.participants.filter((p) => isActiveParticipant(p.status)).length;
    if (parsedBody.data.action === 'ACCEPT') {
        if (participant?.isHost) {
            return res.status(400).json({ message: 'ホストは常に参加者です' });
        }
        const needsSlot = participant && isActiveParticipant(participant.status) ? 0 : 1;
        if (activeCount + needsSlot > groupMeal.capacity) {
            return res.status(400).json({ message: '定員に空きがありません' });
        }
        try {
            await prisma.$transaction(async (tx) => {
                if (participant) {
                    await tx.groupMealParticipant.update({
                        where: { groupMealId_userId: { groupMealId, userId: req.user.userId } },
                        data: { status: GroupMealParticipantStatus.JOINED }
                    });
                }
                else {
                    await tx.groupMealParticipant.create({
                        data: {
                            groupMealId,
                            userId: req.user.userId,
                            isHost: false,
                            status: GroupMealParticipantStatus.JOINED
                        }
                    });
                }
                await syncGroupMealStatus(tx, groupMealId, groupMeal.capacity, groupMeal.status);
            });
            const updated = await fetchGroupMeal(groupMealId);
            return res.json(buildGroupMealPayload(updated, req.user.userId));
        }
        catch (error) {
            console.error('RESPOND GROUP MEAL ACCEPT ERROR:', error);
            return res.status(500).json({ message: 'Failed to accept invitation' });
        }
    }
    // DECLINE
    if (!participant) {
        return res.status(404).json({ message: '招待されていない募集です' });
    }
    if (participant.isHost) {
        return res.status(400).json({ message: 'ホストは辞退できません' });
    }
    try {
        await prisma.$transaction(async (tx) => {
            await tx.groupMealParticipant.update({
                where: { groupMealId_userId: { groupMealId, userId: req.user.userId } },
                data: { status: GroupMealParticipantStatus.DECLINED }
            });
            await syncGroupMealStatus(tx, groupMealId, groupMeal.capacity, groupMeal.status);
        });
        const updated = await fetchGroupMeal(groupMealId);
        return res.json(buildGroupMealPayload(updated, req.user.userId));
    }
    catch (error) {
        console.error('RESPOND GROUP MEAL DECLINE ERROR:', error);
        return res.status(500).json({ message: 'Failed to decline invitation' });
    }
});
groupMealsRouter.post('/:id/join', async (req, res) => {
    const membership = await getApprovedMembership(req.user.userId);
    if (!membership) {
        return res.status(400).json(membershipRequiredResponse);
    }
    const parsedParams = idParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
        return res.status(400).json({ message: 'Invalid group meal id', issues: parsedParams.error.flatten() });
    }
    const groupMealId = parsedParams.data.id;
    const groupMeal = await prisma.groupMeal.findUnique({
        where: { id: groupMealId },
        include: { participants: true }
    });
    if (!groupMeal) {
        return res.status(404).json({ message: 'Group meal not found' });
    }
    if (groupMeal.communityId !== membership.communityId) {
        return res.status(403).json({ message: '別のコミュニティの募集です' });
    }
    if (groupMeal.hostUserId === req.user.userId) {
        return res.status(400).json({ message: 'ホストは既に参加済みです' });
    }
    const participant = groupMeal.participants.find((p) => p.userId === req.user.userId);
    if (participant && isActiveParticipant(participant.status)) {
        return res.status(400).json({ message: '既に参加または招待済みです' });
    }
    const activeCount = groupMeal.participants.filter((p) => isActiveParticipant(p.status)).length;
    if (activeCount + 1 > groupMeal.capacity) {
        return res.status(400).json({ message: '定員に空きがありません' });
    }
    try {
        await prisma.$transaction(async (tx) => {
            if (participant) {
                await tx.groupMealParticipant.update({
                    where: { groupMealId_userId: { groupMealId, userId: req.user.userId } },
                    data: { status: GroupMealParticipantStatus.JOINED }
                });
            }
            else {
                await tx.groupMealParticipant.create({
                    data: {
                        groupMealId,
                        userId: req.user.userId,
                        isHost: false,
                        status: GroupMealParticipantStatus.JOINED
                    }
                });
            }
            await syncGroupMealStatus(tx, groupMealId, groupMeal.capacity, groupMeal.status);
        });
        const updated = await fetchGroupMeal(groupMealId);
        return res.json(buildGroupMealPayload(updated, req.user.userId));
    }
    catch (error) {
        console.error('JOIN GROUP MEAL ERROR:', error);
        return res.status(500).json({ message: 'Failed to join group meal' });
    }
});
groupMealsRouter.post('/:id/leave', async (req, res) => {
    // 1. パラメータ検証
    const parsedParams = idParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
        return res
            .status(400)
            .json({ message: 'Invalid group meal id', issues: parsedParams.error.flatten() });
    }
    const groupMealId = parsedParams.data.id;
    // 2. 一般ユーザーは membership 必須（admin は middleware で既にブロックされる前提）
    const membership = await getApprovedMembership(req.user.userId);
    if (!membership) {
        return res.status(400).json(membershipRequiredResponse);
    }
    try {
        // 3. 対象のグループを取得（参加者付き）
        const groupMeal = await prisma.groupMeal.findUnique({
            where: { id: groupMealId },
            include: { participants: true }
        });
        if (!groupMeal) {
            return res.status(404).json({ message: 'Group meal not found' });
        }
        // 4. コミュニティ一致チェック
        if (groupMeal.communityId !== membership.communityId) {
            return res.status(403).json({ message: '別のコミュニティの募集です' });
        }
        // 5. 自分の参加情報を探す
        const participant = groupMeal.participants.find((p) => p.userId === req.user.userId);
        if (!participant) {
            return res.status(400).json({ message: 'この募集には参加していません' });
        }
        if (participant.isHost) {
            return res
                .status(400)
                .json({ message: 'ホストは退会できません。箱を削除してください。' });
        }
        if (participant.status !== GroupMealParticipantStatus.JOINED) {
            // INVITED や DECLINED/CANCELLED の場合は「参加中ではない」とみなす
            return res.status(400).json({ message: '参加中の募集ではありません' });
        }
        // 6. トランザクション内でステータス更新 & 定員ステータス同期
        await prisma.$transaction(async (tx) => {
            await tx.groupMealParticipant.update({
                where: {
                    groupMealId_userId: {
                        groupMealId,
                        userId: req.user.userId
                    }
                },
                data: {
                    status: GroupMealParticipantStatus.CANCELLED
                }
            });
            await syncGroupMealStatus(tx, groupMealId, groupMeal.capacity, groupMeal.status);
        });
        const updated = await fetchGroupMeal(groupMealId);
        return res.json(buildGroupMealPayload(updated, req.user.userId));
    }
    catch (error) {
        console.error('LEAVE GROUP MEAL ERROR:', error);
        return res.status(500).json({ message: 'Failed to leave group meal' });
    }
});
