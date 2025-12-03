import { Router } from 'express';
import { z } from 'zod';
import { AvailabilityStatus, GroupMealBudget, GroupMealMode, GroupMealParticipantStatus, GroupMealStatus, MealTimeSlot, TimeSlot } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { getApprovedMembership } from '../utils/membership.js';
import { computeExpiresAt } from '../utils/availabilityHelpers.js';
import { pushGroupMealInviteNotification } from '../lib/lineMessages.js';
const placeSchema = z.object({
    name: z.string().min(1),
    address: z.string().nullable().optional(),
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
    googlePlaceId: z.string().nullable().optional()
});
const budgetEnumSchema = z.enum([
    'UNDER_1000',
    'UNDER_1500',
    'UNDER_2000',
    'OVER_2000'
]);
const budgetInputSchema = z
    .union([z.number().int(), budgetEnumSchema])
    .nullable()
    .optional();
const scheduleTimeBandSchema = z.enum(['LUNCH', 'DINNER']);
const scheduleSchema = z.object({
    date: z
        .string()
        // 'YYYY-MM-DD' 形式に限定する
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format'),
    timeBand: scheduleTimeBandSchema,
    // meetingTime は null も許容（フロントから null が来る可能性がある）
    meetingTime: z
        .string()
        .regex(/^\d{2}:\d{2}$/, 'meetingTime must be HH:MM')
        .nullable()
        .optional(),
    place: placeSchema.optional()
});
// ① ネスト形式: { title, capacity, budget, schedule: { ... } }
const createGroupMealNestedSchema = z.object({
    title: z.string().optional().default(''),
    capacity: z.number().int().positive(),
    budget: budgetInputSchema,
    schedule: scheduleSchema
});
// ② フラット形式: { title, date, timeBand, meetingTime, capacity, budget, place* }
const createGroupMealFlatSchema = z.object({
    title: z.string().optional().default(''),
    date: scheduleSchema.shape.date,
    timeBand: scheduleSchema.shape.timeBand,
    meetingTime: scheduleSchema.shape.meetingTime,
    capacity: z.number().int().positive(),
    budget: budgetInputSchema,
    placeName: z.string().optional(),
    placeAddress: z.string().optional(),
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional()
});
const scheduleUpdateSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    timeBand: scheduleTimeBandSchema.optional(),
    meetingTime: z.union([z.string().regex(/^\d{2}:\d{2}$/), z.null()]).optional(),
    place: placeSchema.nullable().optional()
});
const updateGroupMealSchema = z.object({
    schedule: scheduleUpdateSchema.optional(),
    meetingPlace: z.string().trim().max(255).optional()
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
const groupMealIdParamSchema = z.object({
    groupMealId: z.string().uuid()
});
const invitationIdParamSchema = z.object({
    invitationId: z.string().uuid()
});
function parseScheduleDate(dateString) {
    const parsed = new Date(`${dateString}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error('Invalid schedule date');
    }
    return parsed;
}
function mapTimeBandToTimeSlot(timeBand) {
    return timeBand === 'LUNCH' ? TimeSlot.DAY : TimeSlot.NIGHT;
}
function mapTimeBandToMealTimeSlot(timeBand) {
    return timeBand === 'LUNCH' ? MealTimeSlot.LUNCH : MealTimeSlot.DINNER;
}
function mapTimeSlotToTimeBand(timeSlot) {
    return timeSlot === TimeSlot.DAY ? 'LUNCH' : 'DINNER';
}
function parseTimeToMinutes(time) {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
}
function formatMinutesToTimeString(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}
function validateMeetingTime(minutes, timeBand) {
    const { min, max } = timeBand === 'LUNCH'
        ? { min: 10 * 60, max: 15 * 60 }
        : { min: 18 * 60, max: 23 * 60 };
    if (minutes < min || minutes > max) {
        throw new Error('meetingTime is out of allowed range for this timeBand');
    }
    if (minutes % 30 !== 0) {
        throw new Error('meetingTime must be in 30-minute increments');
    }
}
function formatDateToIsoDay(date) {
    return date.toISOString().slice(0, 10);
}
const BUDGET_ENUM_VALUES = [
    'UNDER_1000',
    'UNDER_1500',
    'UNDER_2000',
    'OVER_2000'
];
function mapBudgetValueToEnum(value) {
    if (value == null)
        return null;
    if (typeof value === 'string') {
        if (BUDGET_ENUM_VALUES.includes(value)) {
            return value;
        }
        const parsed = Number(value);
        if (!Number.isNaN(parsed)) {
            return mapBudgetValueToEnum(parsed);
        }
        return null;
    }
    if (value <= 1000)
        return GroupMealBudget.UNDER_1000;
    if (value <= 1500)
        return GroupMealBudget.UNDER_1500;
    if (value <= 2000)
        return GroupMealBudget.UNDER_2000;
    return GroupMealBudget.OVER_2000;
}
function membershipIsHost(membership, groupMeal) {
    if (!membership)
        return false;
    if (groupMeal.hostMembershipId) {
        return membership.id === groupMeal.hostMembershipId;
    }
    return membership.userId === groupMeal.hostUserId;
}
function requireAdmin(req, res, next) {
    if (!req.user?.isAdmin) {
        return res.status(403).json({ message: '管理者のみ利用できます' });
    }
    return next();
}
const updateParticipantStatusSchema = z.object({
    status: z.enum(['JOINED', 'LATE', 'CANCELLED'])
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
function buildSchedulePayloadFromGroupMeal(groupMeal) {
    const meetingTimeMinutes = groupMeal.meetingTimeMinutes ?? null;
    const placeName = groupMeal.placeName ?? groupMeal.meetingPlace ?? null;
    const place = placeName == null
        ? null
        : {
            name: placeName,
            address: groupMeal.placeAddress ?? null,
            latitude: groupMeal.placeLatitude ?? null,
            longitude: groupMeal.placeLongitude ?? null,
            googlePlaceId: groupMeal.placeGooglePlaceId ?? null
        };
    return {
        date: formatDateToIsoDay(groupMeal.date),
        timeBand: mapTimeSlotToTimeBand(groupMeal.timeSlot),
        meetingTime: meetingTimeMinutes !== null ? formatMinutesToTimeString(meetingTimeMinutes) : null,
        meetingTimeMinutes,
        place
    };
}
const ACTIVE_PARTICIPANT_STATUSES = [
    GroupMealParticipantStatus.INVITED,
    GroupMealParticipantStatus.JOINED,
    GroupMealParticipantStatus.LATE
];
const ATTENDING_PARTICIPANT_STATUSES = [
    GroupMealParticipantStatus.JOINED,
    GroupMealParticipantStatus.LATE
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
        favoriteMeals: participant.user.profile?.favoriteMeals || [],
        profileImageUrl: participant.user.profile?.profileImageUrl ?? null
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
    if (me.status === GroupMealParticipantStatus.LATE)
        return 'LATE';
    return 'NONE';
}
function buildGroupMealPayload(groupMeal, currentUserId, opts = {}) {
    const joinedCount = groupMeal.participants.filter((p) => ATTENDING_PARTICIPANT_STATUSES.includes(p.status)).length;
    const participants = (opts.joinedOnly
        ? groupMeal.participants.filter((p) => ATTENDING_PARTICIPANT_STATUSES.includes(p.status))
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
            name: groupMeal.host.profile?.name || '',
            profileImageUrl: groupMeal.host.profile?.profileImageUrl ?? null
        },
        meetingPlace: groupMeal.meetingPlace ?? null,
        schedule: buildSchedulePayloadFromGroupMeal(groupMeal),
        budget: groupMeal.budget ?? null,
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
groupMealsRouter.post('/', requireAdmin, async (req, res) => {
    const membership = await getApprovedMembership(req.user.userId);
    if (!membership) {
        return res.status(400).json(membershipRequiredResponse);
    }
    let parsed = createGroupMealNestedSchema.safeParse(req.body);
    if (!parsed.success) {
        const flatResult = createGroupMealFlatSchema.safeParse(req.body);
        if (!flatResult.success) {
            console.error('CREATE GROUP MEAL INVALID BODY', {
                body: req.body,
                nestedError: parsed.error.format(),
                flatError: flatResult.error.format()
            });
            return res.status(400).json({ message: 'Invalid input' });
        }
        const f = flatResult.data;
        parsed = {
            success: true,
            data: {
                title: f.title,
                capacity: f.capacity,
                budget: f.budget ?? null,
                schedule: {
                    date: f.date,
                    timeBand: f.timeBand,
                    meetingTime: f.meetingTime ?? null,
                    place: f.placeName && f.placeName.trim().length > 0
                        ? {
                            name: f.placeName.trim(),
                            address: f.placeAddress?.trim() || null,
                            latitude: f.latitude ?? null,
                            longitude: f.longitude ?? null,
                            googlePlaceId: null
                        }
                        : undefined
                }
            }
        };
    }
    const { title, capacity, budget, schedule } = parsed.data;
    const normalizedBudget = mapBudgetValueToEnum(budget ?? null);
    const date = parseScheduleDate(schedule.date);
    const weekday = getWeekdayFromDate(date);
    const timeSlot = mapTimeBandToTimeSlot(schedule.timeBand);
    const meetingTimeMinutes = schedule.meetingTime != null
        ? (() => {
            const [hours, minutes] = schedule.meetingTime.split(':').map(Number);
            return hours * 60 + minutes;
        })()
        : null;
    const mealTimeSlot = mapTimeBandToMealTimeSlot(schedule.timeBand);
    const expiresAt = computeExpiresAt(date, mealTimeSlot);
    if (meetingTimeMinutes !== null) {
        validateMeetingTime(meetingTimeMinutes, schedule.timeBand);
    }
    const place = schedule.place;
    const placeName = place?.name ?? null;
    const placeAddress = place?.address ?? null;
    const placeLatitude = place?.latitude ?? null;
    const placeLongitude = place?.longitude ?? null;
    const placeGooglePlaceId = place?.googlePlaceId ?? null;
    const meetingPlace = placeName;
    const locationName = meetingPlace ?? placeName ?? null;
    const locationLatitude = placeLatitude ?? null;
    const locationLongitude = placeLongitude ?? null;
    const now = new Date();
    try {
        const groupMeal = await prisma.groupMeal.create({
            data: {
                communityId: membership.communityId,
                hostUserId: req.user.userId,
                hostMembershipId: membership.id,
                title,
                date,
                weekday,
                timeSlot,
                mode: GroupMealMode.REAL,
                mealTimeSlot,
                locationName,
                latitude: locationLatitude,
                longitude: locationLongitude,
                capacity,
                meetingPlace,
                meetingTimeMinutes,
                placeName,
                placeAddress,
                placeLatitude,
                placeLongitude,
                placeGooglePlaceId,
                budget: normalizedBudget,
                createdById: req.user.userId,
                expiresAt,
                talkTopics: [],
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
        console.error('CREATE GROUP MEAL ERROR', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});
groupMealsRouter.patch('/:id', async (req, res) => {
    const membership = await getApprovedMembership(req.user.userId);
    if (!membership) {
        return res.status(400).json(membershipRequiredResponse);
    }
    const parsedParams = idParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
        return res
            .status(400)
            .json({ message: 'Invalid group meal id', issues: parsedParams.error.flatten() });
    }
    const groupMealId = parsedParams.data.id;
    const parsedBody = updateGroupMealSchema.safeParse(req.body);
    if (!parsedBody.success) {
        return res.status(400).json({ message: 'Invalid body', issues: parsedBody.error.flatten() });
    }
    const groupMeal = await prisma.groupMeal.findUnique({
        where: { id: groupMealId }
    });
    if (!groupMeal) {
        return res.status(404).json({ message: 'Group meal not found' });
    }
    if (!membershipIsHost(membership, groupMeal)) {
        return res.status(403).json({ message: 'ホストのみ更新できます' });
    }
    let updateData = {};
    try {
        const schedule = parsedBody.data.schedule;
        if (schedule) {
            if (schedule.date) {
                const date = parseScheduleDate(schedule.date);
                updateData.date = date;
                updateData.weekday = getWeekdayFromDate(date);
            }
            let currentTimeSlot = schedule.timeBand
                ? mapTimeBandToTimeSlot(schedule.timeBand)
                : groupMeal.timeSlot;
            if (schedule.timeBand) {
                updateData.timeSlot = mapTimeBandToTimeSlot(schedule.timeBand);
            }
            if (schedule.meetingTime !== undefined) {
                if (schedule.meetingTime === null) {
                    updateData.meetingTimeMinutes = null;
                }
                else {
                    const minutes = parseTimeToMinutes(schedule.meetingTime);
                    const timeBandForValidation = schedule.timeBand ?? mapTimeSlotToTimeBand(currentTimeSlot);
                    validateMeetingTime(minutes, timeBandForValidation);
                    updateData.meetingTimeMinutes = minutes;
                }
            }
            if (schedule.place !== undefined) {
                if (schedule.place === null) {
                    updateData.placeName = null;
                    updateData.placeAddress = null;
                    updateData.placeLatitude = null;
                    updateData.placeLongitude = null;
                    updateData.placeGooglePlaceId = null;
                    if (parsedBody.data.meetingPlace === undefined) {
                        updateData.meetingPlace = null;
                    }
                }
                else {
                    updateData.placeName = schedule.place.name;
                    updateData.placeAddress = schedule.place.address ?? null;
                    updateData.placeLatitude = schedule.place.latitude ?? null;
                    updateData.placeLongitude = schedule.place.longitude ?? null;
                    updateData.placeGooglePlaceId = schedule.place.googlePlaceId ?? null;
                    updateData.meetingPlace = schedule.place.name;
                }
            }
        }
        if (parsedBody.data.meetingPlace) {
            updateData.meetingPlace = parsedBody.data.meetingPlace;
            if (updateData.placeName == null) {
                updateData.placeName = parsedBody.data.meetingPlace;
            }
        }
    }
    catch (error) {
        return res.status(400).json({ message: error.message });
    }
    if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ message: '更新対象がありません' });
    }
    try {
        const updated = await prisma.groupMeal.update({
            where: { id: groupMealId },
            data: updateData,
            include: groupMealInclude
        });
        return res.json(buildGroupMealPayload(updated, req.user.userId));
    }
    catch (error) {
        console.error('UPDATE GROUP MEAL ERROR:', error);
        return res.status(500).json({ message: 'Failed to update group meal' });
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
    const now = new Date();
    try {
        const groupMeals = await prisma.groupMeal.findMany({
            where: {
                ...(membership ? { communityId: membership.communityId } : {}),
                status: { in: [GroupMealStatus.OPEN, GroupMealStatus.FULL] },
                date: { gte: today },
                OR: [
                    { expiresAt: null },
                    { expiresAt: { gt: now } }
                ]
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
        if (groupMeal.expiresAt && groupMeal.expiresAt <= new Date()) {
            return res.status(404).json({ message: 'この募集は終了しています' });
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
groupMealsRouter.get('/:groupMealId/invitations', async (req, res) => {
    const membership = await getApprovedMembership(req.user.userId);
    if (!membership) {
        return res.status(400).json(membershipRequiredResponse);
    }
    const parsedParams = groupMealIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
        return res.status(400).json({ message: 'Invalid group meal id', issues: parsedParams.error.flatten() });
    }
    const groupMealId = parsedParams.data.groupMealId;
    const groupMeal = await prisma.groupMeal.findUnique({
        where: { id: groupMealId }
    });
    if (!groupMeal) {
        return res.status(404).json({ message: 'Group meal not found' });
    }
    if (groupMeal.communityId !== membership.communityId) {
        return res.status(403).json({ message: '別のコミュニティの募集です' });
    }
    if (!membershipIsHost(membership, groupMeal)) {
        return res.status(403).json({ message: '招待一覧を取得できるのはホストのみです' });
    }
    try {
        const invitations = await prisma.groupMealCandidate.findMany({
            where: { groupMealId },
            include: {
                user: { include: { profile: true } }
            },
            orderBy: { invitedAt: 'asc' }
        });
        const result = invitations.map((inv) => {
            const lineStatus = inv.firstOpenedAt ? 'OPENED' : 'SENT_UNOPENED';
            return {
                id: inv.id,
                userId: inv.userId,
                name: inv.user.profile?.name ?? '',
                profileImageUrl: inv.user.profile?.profileImageUrl ?? null,
                favoriteMeals: inv.user.profile?.favoriteMeals ?? [],
                invitedAt: inv.invitedAt.toISOString(),
                isCanceled: inv.isCanceled,
                canceledAt: inv.canceledAt?.toISOString() ?? null,
                lineStatus,
                firstOpenedAt: inv.firstOpenedAt?.toISOString() ?? null,
                lastOpenedAt: inv.lastOpenedAt?.toISOString() ?? null
            };
        });
        return res.json({ invitations: result });
    }
    catch (error) {
        console.error('FETCH INVITATIONS ERROR:', error);
        return res.status(500).json({ message: 'Failed to fetch invitations' });
    }
});
groupMealsRouter.delete('/:id', requireAdmin, async (req, res) => {
    const parsedParams = idParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
        return res
            .status(400)
            .json({ message: 'Invalid group meal id', issues: parsedParams.error.flatten() });
    }
    const groupMealId = parsedParams.data.id;
    try {
        const groupMeal = await prisma.groupMeal.findUnique({
            where: { id: groupMealId },
            select: { id: true }
        });
        if (!groupMeal) {
            return res.status(404).json({ message: 'Group meal not found' });
        }
        await prisma.$transaction([
            prisma.groupMealCandidate.deleteMany({ where: { groupMealId } }),
            prisma.groupMealParticipant.deleteMany({ where: { groupMealId } }),
            prisma.groupMeal.delete({ where: { id: groupMealId } })
        ]);
        return res.status(204).send();
    }
    catch (error) {
        console.error('DELETE GROUP MEAL ERROR', error);
        return res.status(500).json({ message: 'Internal server error' });
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
    if (!membershipIsHost(membership, groupMeal)) {
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
            profileImageUrl: u.profile?.profileImageUrl ?? null,
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
    if (!membershipIsHost(membership, groupMeal)) {
        return res.status(403).json({ message: '招待できるのはホストのみです' });
    }
    if (groupMeal.communityId !== membership.communityId) {
        return res.status(403).json({ message: '別のコミュニティの募集です' });
    }
    if (uniqueUserIds.includes(req.user.userId)) {
        return res.status(400).json({ message: 'ホスト自身は招待できません' });
    }
    const existingParticipantIds = new Set(groupMeal.participants.map((p) => p.userId));
    const newParticipantIds = uniqueUserIds.filter((id) => !existingParticipantIds.has(id));
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
                await tx.groupMealCandidate.upsert({
                    where: { groupMealId_userId: { groupMealId, userId } },
                    update: {
                        invitedAt: new Date(),
                        invitedByUserId: req.user.userId,
                        isCanceled: false,
                        canceledAt: null,
                        firstOpenedAt: null,
                        lastOpenedAt: null
                    },
                    create: {
                        groupMealId,
                        userId,
                        invitedByUserId: req.user.userId
                    }
                });
            }
            await syncGroupMealStatus(tx, groupMealId, groupMeal.capacity, groupMeal.status);
        });
        if (newParticipantIds.length > 0) {
            const usersToNotify = await prisma.user.findMany({
                where: { id: { in: newParticipantIds } },
                select: { id: true, lineUserId: true }
            });
            for (const user of usersToNotify) {
                if (!user.lineUserId) {
                    console.warn('[group-meals] skip LINE invite: missing lineUserId', {
                        targetUserId: user.id
                    });
                    continue;
                }
                try {
                    await pushGroupMealInviteNotification(user.lineUserId);
                }
                catch (error) {
                    console.error('[group-meals] failed to push LINE invite', {
                        targetUserId: user.id,
                        error
                    });
                }
            }
        }
        const updated = await fetchGroupMeal(groupMealId);
        return res.json(buildGroupMealPayload(updated, req.user.userId));
    }
    catch (error) {
        console.error('INVITE GROUP MEAL CANDIDATES ERROR:', error);
        return res.status(500).json({ message: 'Failed to invite candidates' });
    }
});
groupMealsRouter.post('/invitations/:invitationId/cancel', async (req, res) => {
    const membership = await getApprovedMembership(req.user.userId);
    if (!membership) {
        return res.status(400).json(membershipRequiredResponse);
    }
    const parsedParams = invitationIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
        return res.status(400).json({ message: 'Invalid invitation id', issues: parsedParams.error.flatten() });
    }
    const invitation = await prisma.groupMealCandidate.findUnique({
        where: { id: parsedParams.data.invitationId },
        include: { groupMeal: true }
    });
    if (!invitation) {
        return res.status(404).json({ message: 'Invitation not found' });
    }
    if (invitation.groupMeal.communityId !== membership.communityId) {
        return res.status(403).json({ message: '別のコミュニティの募集です' });
    }
    if (!membershipIsHost(membership, invitation.groupMeal)) {
        return res.status(403).json({ message: 'キャンセルできるのはホストのみです' });
    }
    if (invitation.isCanceled) {
        return res.status(204).send();
    }
    try {
        await prisma.groupMealCandidate.update({
            where: { id: invitation.id },
            data: {
                isCanceled: true,
                canceledAt: new Date()
            }
        });
        // TODO: send cancellation notification via LINE when needed
        return res.status(204).send();
    }
    catch (error) {
        console.error('CANCEL INVITATION ERROR:', error);
        return res.status(500).json({ message: 'Failed to cancel invitation' });
    }
});
groupMealsRouter.post('/invitations/:invitationId/open', async (req, res) => {
    const parsedParams = invitationIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
        return res.status(400).json({ message: 'Invalid invitation id', issues: parsedParams.error.flatten() });
    }
    const invitation = await prisma.groupMealCandidate.findUnique({
        where: { id: parsedParams.data.invitationId }
    });
    if (!invitation) {
        return res.status(404).json({ message: 'Invitation not found' });
    }
    if (invitation.userId !== req.user.userId) {
        return res.status(403).json({ message: '自分の招待のみ開封を記録できます' });
    }
    const now = new Date();
    try {
        await prisma.groupMealCandidate.update({
            where: { id: invitation.id },
            data: {
                firstOpenedAt: invitation.firstOpenedAt ?? now,
                lastOpenedAt: now
            }
        });
        return res.status(204).send();
    }
    catch (error) {
        console.error('OPEN INVITATION ERROR:', error);
        return res.status(500).json({ message: 'Failed to update invitation status' });
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
groupMealsRouter.patch('/:groupMealId/participant/status', async (req, res) => {
    const membership = await getApprovedMembership(req.user.userId);
    if (!membership) {
        return res.status(400).json(membershipRequiredResponse);
    }
    const parsedParams = groupMealIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
        return res.status(400).json({ message: 'Invalid group meal id', issues: parsedParams.error.flatten() });
    }
    const groupMealId = parsedParams.data.groupMealId;
    const parsedBody = updateParticipantStatusSchema.safeParse(req.body);
    if (!parsedBody.success) {
        return res.status(400).json({ message: 'Invalid body', issues: parsedBody.error.flatten() });
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
    if (!participant) {
        return res.status(404).json({ message: '参加メンバーとして登録されていません' });
    }
    try {
        await prisma.$transaction(async (tx) => {
            await tx.groupMealParticipant.update({
                where: { id: participant.id },
                data: { status: parsedBody.data.status }
            });
            await syncGroupMealStatus(tx, groupMeal.id, groupMeal.capacity, groupMeal.status);
        });
        const updated = await fetchGroupMeal(groupMealId);
        return res.json(buildGroupMealPayload(updated, req.user.userId));
    }
    catch (error) {
        console.error('UPDATE PARTICIPANT STATUS ERROR:', error);
        return res.status(500).json({ message: 'Failed to update participant status' });
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
        if (!ATTENDING_PARTICIPANT_STATUSES.includes(participant.status)) {
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
