import { Router } from 'express';
import { z } from 'zod';
import { AvailabilityStatus, PairMealStatus, ScheduleTimeBand, TimeSlot, Weekday } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { ensureSameCommunity, getApprovedMembership } from '../utils/membership.js';
import { getPairAvailabilitySlots, countUserAvailableSlots, MIN_REQUIRED_AVAILABILITY } from '../utils/availability.js';
const availabilitySchema = z.array(z.object({
    weekday: z.nativeEnum(Weekday),
    timeSlot: z.nativeEnum(TimeSlot),
    status: z.nativeEnum(AvailabilityStatus)
}));
const overlapParamsSchema = z.object({
    partnerUserId: z.string().uuid()
});
const calendarRangeSchema = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});
export const availabilityRouter = Router();
availabilityRouter.use(authMiddleware);
// admin ユーザーには提供しない API なのでここで弾く
availabilityRouter.use((req, res, next) => {
    if (req.user?.isAdmin) {
        return res.status(403).json({ message: '一般ユーザーのみ利用できます' });
    }
    next();
});
availabilityRouter.get('/status', async (req, res) => {
    try {
        const availableCount = await countUserAvailableSlots(req.user.userId);
        const required = MIN_REQUIRED_AVAILABILITY;
        return res.json({
            availableCount,
            required,
            meetsRequirement: availableCount >= required
        });
    }
    catch (error) {
        console.error('FETCH AVAILABILITY STATUS ERROR:', error);
        return res.status(500).json({ message: 'Failed to fetch availability status' });
    }
});
// この API はあくまで「曜日 x 昼夜」の週次パターンを管理するもの。
// フロントエンドが「今日から7日間」を表示する場合も、日付→Weekdayに変換してこの週次APIを呼び出す。
availabilityRouter.get('/', async (req, res) => {
    const fromParam = getStringQueryParam(req.query.from);
    const toParam = getStringQueryParam(req.query.to);
    if (fromParam !== undefined || toParam !== undefined) {
        const parsed = calendarRangeSchema.safeParse({ from: fromParam, to: toParam });
        if (!parsed.success) {
            return res.status(400).json({ message: 'Invalid date range', issues: parsed.error.flatten() });
        }
        return handleCalendarAvailability(req, res, parsed.data);
    }
    try {
        const slots = await prisma.availabilitySlot.findMany({
            where: { userId: req.user.userId },
            select: { weekday: true, timeSlot: true, status: true },
            orderBy: [{ weekday: 'asc' }, { timeSlot: 'asc' }]
        });
        return res.json(slots);
    }
    catch (error) {
        console.error('FETCH AVAILABILITY ERROR:', error);
        return res.status(500).json({ message: 'Failed to fetch availability' });
    }
});
availabilityRouter.put('/', async (req, res) => {
    const parsed = availabilitySchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid input', issues: parsed.error.flatten() });
    }
    const seen = new Set();
    for (const slot of parsed.data) {
        const key = `${slot.weekday}-${slot.timeSlot}`;
        if (seen.has(key)) {
            return res
                .status(400)
                .json({ message: 'weekday と timeSlot の組み合わせは重複できません' });
        }
        seen.add(key);
    }
    try {
        await prisma.$transaction(async (tx) => {
            await tx.availabilitySlot.deleteMany({ where: { userId: req.user.userId } });
            if (parsed.data.length === 0) {
                return;
            }
            await tx.availabilitySlot.createMany({
                data: parsed.data.map((slot) => ({
                    ...slot,
                    userId: req.user.userId
                }))
            });
        });
        const slots = await prisma.availabilitySlot.findMany({
            where: { userId: req.user.userId },
            select: { weekday: true, timeSlot: true, status: true },
            orderBy: [{ weekday: 'asc' }, { timeSlot: 'asc' }]
        });
        return res.json(slots);
    }
    catch (error) {
        console.error('UPSERT AVAILABILITY ERROR:', error);
        return res.status(500).json({ message: 'Failed to update availability' });
    }
});
// 2人の曜日 x timeSlot で両者の空き状態を返す
availabilityRouter.get('/pair/:partnerUserId', async (req, res) => {
    const parsedParams = overlapParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
        return res.status(400).json({ message: 'Invalid partnerUserId', issues: parsedParams.error.flatten() });
    }
    const currentUserId = req.user.userId;
    const partnerUserId = parsedParams.data.partnerUserId;
    try {
        const membership = await getApprovedMembership(currentUserId);
        if (!membership) {
            return res.status(403).json({ message: 'コミュニティ参加後にご利用ください' });
        }
        try {
            await ensureSameCommunity(currentUserId, partnerUserId, membership.communityId);
        }
        catch (error) {
            return res.status(403).json({ message: error.message });
        }
        const slots = await getPairAvailabilitySlots(currentUserId, partnerUserId);
        return res.json({ slots });
    }
    catch (error) {
        console.error('FETCH PAIR AVAILABILITY ERROR:', error);
        return res.status(500).json({ message: 'Failed to fetch pair availability' });
    }
});
// 指定ユーザーと自分の AVAILABLE スロットの交差を返す
availabilityRouter.get('/overlap/:partnerUserId', async (req, res) => {
    const parsedParams = overlapParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
        return res.status(400).json({ message: 'Invalid partnerUserId', issues: parsedParams.error.flatten() });
    }
    const currentUserId = req.user.userId;
    const partnerUserId = parsedParams.data.partnerUserId;
    try {
        const membership = await getApprovedMembership(currentUserId);
        if (!membership) {
            return res.status(403).json({ message: 'マッチしていないユーザーの日程は参照できません' });
        }
        // マッチ済みかをコミュニティ込みで確認
        const match = await prisma.match.findFirst({
            where: {
                communityId: membership.communityId,
                OR: [
                    { user1Id: currentUserId, user2Id: partnerUserId },
                    { user1Id: partnerUserId, user2Id: currentUserId }
                ]
            }
        });
        if (!match) {
            return res.status(403).json({ message: 'マッチしていないユーザーの日程は参照できません' });
        }
        const [mySlots, partnerSlots] = await Promise.all([
            prisma.availabilitySlot.findMany({
                where: { userId: currentUserId, status: AvailabilityStatus.AVAILABLE },
                select: { weekday: true, timeSlot: true },
                orderBy: [{ weekday: 'asc' }, { timeSlot: 'asc' }]
            }),
            prisma.availabilitySlot.findMany({
                where: { userId: partnerUserId, status: AvailabilityStatus.AVAILABLE },
                select: { weekday: true, timeSlot: true },
                orderBy: [{ weekday: 'asc' }, { timeSlot: 'asc' }]
            })
        ]);
        // 共通スロットを計算
        const partnerSet = new Set(partnerSlots.map((slot) => `${slot.weekday}-${slot.timeSlot}`));
        const overlap = mySlots.filter((slot) => partnerSet.has(`${slot.weekday}-${slot.timeSlot}`));
        return res.json(overlap);
    }
    catch (error) {
        console.error('FETCH OVERLAP AVAILABILITY ERROR:', error);
        return res.status(500).json({ message: 'Failed to fetch overlap availability' });
    }
});
const DEFAULT_CALENDAR_WINDOW_DAYS = 6;
const TIME_BANDS = [ScheduleTimeBand.LUNCH, ScheduleTimeBand.DINNER];
const WEEKDAY_FROM_INDEX = [
    Weekday.SUN,
    Weekday.MON,
    Weekday.TUE,
    Weekday.WED,
    Weekday.THU,
    Weekday.FRI,
    Weekday.SAT
];
const TIME_BAND_TO_TIME_SLOT = {
    [ScheduleTimeBand.LUNCH]: TimeSlot.DAY,
    [ScheduleTimeBand.DINNER]: TimeSlot.NIGHT
};
const slotKey = (date, timeBand) => `${date}:${timeBand}`;
async function handleCalendarAvailability(req, res, range) {
    try {
        const membership = await getApprovedMembership(req.user.userId);
        if (!membership) {
            return res.status(403).json({ message: 'Forbidden' });
        }
        const { startDate, endDate } = resolveCalendarRange(range);
        const dates = buildDateList(startDate, endDate);
        const weekdays = Array.from(new Set(dates.map(getWeekdayFromDate)));
        const availabilityEntries = await prisma.availabilitySlot.findMany({
            where: {
                userId: membership.userId,
                weekday: { in: weekdays }
            },
            select: { weekday: true, timeSlot: true, status: true }
        });
        const availabilityMap = new Map();
        for (const entry of availabilityEntries) {
            availabilityMap.set(`${entry.weekday}-${entry.timeSlot}`, entry.status);
        }
        const slotsMap = new Map();
        for (const date of dates) {
            const dateString = formatDateToIsoDay(date);
            const weekday = getWeekdayFromDate(date);
            for (const timeBand of TIME_BANDS) {
                const availabilityKey = `${weekday}-${TIME_BAND_TO_TIME_SLOT[timeBand]}`;
                const status = mapAvailabilityStatusToCalendarStatus(availabilityMap.get(availabilityKey));
                slotsMap.set(slotKey(dateString, timeBand), {
                    date: dateString,
                    timeBand,
                    status,
                    groupMeals: [],
                    pairMeals: [],
                    isBlockedByGroupMeal: false,
                    isBlockedByPairMeal: false
                });
            }
        }
        const groupMeals = await prisma.groupMeal.findMany({
            where: {
                communityId: membership.communityId,
                date: { gte: startDate, lte: buildEndOfDay(endDate) },
                participants: {
                    some: { userId: membership.userId }
                }
            },
            include: {
                participants: {
                    select: { userId: true, isHost: true }
                }
            }
        });
        for (const meal of groupMeals) {
            const dateString = formatDateToIsoDay(meal.date);
            const timeBand = mapTimeSlotToScheduleBand(meal.timeSlot);
            const slot = slotsMap.get(slotKey(dateString, timeBand));
            if (!slot) {
                continue;
            }
            const participant = meal.participants.find((p) => p.userId === membership.userId);
            const isHost = meal.hostMembershipId === membership.id ||
                meal.hostUserId === membership.userId ||
                participant?.isHost === true;
            slot.groupMeals.push({
                id: meal.id,
                title: meal.title ?? '',
                isHost
            });
            slot.isBlockedByGroupMeal = true;
            slot.status = 'NO';
        }
        const pairMeals = await prisma.pairMeal.findMany({
            where: {
                status: PairMealStatus.CONFIRMED,
                date: {
                    gte: formatDateToIsoDay(startDate),
                    lte: formatDateToIsoDay(endDate)
                },
                OR: [{ memberAId: membership.id }, { memberBId: membership.id }]
            },
            include: {
                match: {
                    include: {
                        user1: { include: { profile: true } },
                        user2: { include: { profile: true } }
                    }
                }
            }
        });
        for (const pairMeal of pairMeals) {
            const slot = slotsMap.get(slotKey(pairMeal.date, pairMeal.timeBand));
            if (!slot || !pairMeal.match) {
                continue;
            }
            const isUser1 = pairMeal.match.user1Id === membership.userId;
            const partner = isUser1 ? pairMeal.match.user2 : pairMeal.match.user1;
            const partnerName = partner?.profile?.name ?? partner?.lineDisplayName ?? '';
            slot.pairMeals.push({
                id: pairMeal.id,
                matchId: pairMeal.matchId,
                partnerName
            });
            slot.isBlockedByPairMeal = true;
            slot.status = 'NO';
        }
        return res.json({ slots: Array.from(slotsMap.values()) });
    }
    catch (error) {
        if (error instanceof CalendarRangeError) {
            return res.status(400).json({ message: error.message });
        }
        console.error('FETCH CALENDAR AVAILABILITY ERROR:', error);
        return res.status(500).json({ message: 'Failed to fetch calendar availability' });
    }
}
class CalendarRangeError extends Error {
}
function resolveCalendarRange(range) {
    const startDate = range.from ? parseIsoDay(range.from) : getTodayUtcDate();
    const endDate = range.to ? parseIsoDay(range.to) : addDays(startDate, DEFAULT_CALENDAR_WINDOW_DAYS);
    if (endDate.getTime() < startDate.getTime()) {
        throw new CalendarRangeError('`to` must be on or after `from`');
    }
    return { startDate, endDate };
}
function buildDateList(startDate, endDate) {
    const dates = [];
    let current = new Date(startDate);
    while (current.getTime() <= endDate.getTime()) {
        dates.push(new Date(current));
        current = addDays(current, 1);
    }
    return dates;
}
function addDays(date, days) {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
}
function parseIsoDay(value) {
    const [year, month, day] = value.split('-').map(Number);
    if ([year, month, day].some((part) => Number.isNaN(part))) {
        throw new CalendarRangeError('Invalid date');
    }
    return new Date(Date.UTC(year, month - 1, day));
}
function getTodayUtcDate() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function formatDateToIsoDay(date) {
    return date.toISOString().slice(0, 10);
}
function buildEndOfDay(date) {
    const result = new Date(date);
    result.setUTCHours(23, 59, 59, 999);
    return result;
}
function getWeekdayFromDate(date) {
    return WEEKDAY_FROM_INDEX[date.getUTCDay()];
}
function mapTimeSlotToScheduleBand(timeSlot) {
    return timeSlot === TimeSlot.DAY ? ScheduleTimeBand.LUNCH : ScheduleTimeBand.DINNER;
}
function mapAvailabilityStatusToCalendarStatus(status) {
    if (status === AvailabilityStatus.AVAILABLE) {
        return 'YES';
    }
    if (status === AvailabilityStatus.UNAVAILABLE) {
        return 'NO';
    }
    return 'UNKNOWN';
}
function getStringQueryParam(value) {
    if (Array.isArray(value)) {
        const first = value[0];
        return typeof first === 'string' ? first : undefined;
    }
    return typeof value === 'string' ? value : undefined;
}
