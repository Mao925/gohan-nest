import { Router } from 'express';
import { z } from 'zod';
import { AvailabilityStatus, TimeSlot, Weekday } from '@prisma/client';
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
