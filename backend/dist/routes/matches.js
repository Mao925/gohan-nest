import { Router } from 'express';
import { PairMealStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { ensureSufficientAvailability } from '../middleware/ensureAvailability.js';
import { getApprovedMembership } from '../utils/membership.js';
export const matchesRouter = Router();
matchesRouter.use(authMiddleware);
const pairMealCreateSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timeBand: z.enum(['LUNCH', 'DINNER']),
    meetingTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    placeName: z.string().optional(),
    placeAddress: z.string().optional(),
    restaurantName: z.string().optional(),
    restaurantAddress: z.string().optional(),
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
    googlePlaceId: z.string().optional()
});
const pairMealUpdateSchema = pairMealCreateSchema.partial();
matchesRouter.get('/', ensureSufficientAvailability, async (req, res) => {
    const membership = await getApprovedMembership(req.user.userId);
    if (!membership) {
        return res.json([]);
    }
    const matches = await prisma.match.findMany({
        where: {
            communityId: membership.communityId,
            OR: [{ user1Id: req.user.userId }, { user2Id: req.user.userId }]
        },
        include: {
            user1: { include: { profile: true } },
            user2: { include: { profile: true } }
        }
    });
    const data = matches.map((match) => {
        const isUser1 = match.user1Id === req.user.userId;
        const partner = isUser1 ? match.user2 : match.user1;
        return {
            id: match.id,
            partnerName: partner.profile?.name || '',
            partnerFavoriteMeals: partner.profile?.favoriteMeals || [],
            profileImageUrl: partner.profile?.profileImageUrl ?? null,
            matchedAt: match.createdAt.toISOString()
        };
    });
    res.json(data);
});
matchesRouter.post('/:matchId/pair-meals', async (req, res) => {
    try {
        const { matchId } = req.params;
        const parsed = pairMealCreateSchema.safeParse(req.body);
        if (!parsed.success) {
            console.error('CREATE PAIR MEAL INVALID BODY', parsed.error.format());
            return res.status(400).json({ message: 'Invalid input' });
        }
        const payload = parsed.data;
        const membership = await getApprovedMembership(req.user.userId);
        if (!membership) {
            return res.status(403).json({ message: 'Forbidden' });
        }
        const match = await prisma.match.findUnique({
            where: { id: matchId }
        });
        if (!match) {
            return res.status(404).json({ message: 'Match not found' });
        }
        if (match.communityId !== membership.communityId) {
            return res.status(403).json({ message: 'Forbidden' });
        }
        if (match.user1Id !== membership.userId && match.user2Id !== membership.userId) {
            return res.status(403).json({ message: 'Forbidden' });
        }
        const matchMemberships = await prisma.communityMembership.findMany({
            where: {
                communityId: membership.communityId,
                status: 'approved',
                userId: { in: [match.user1Id, match.user2Id] }
            }
        });
        const memberMap = new Map(matchMemberships.map((m) => [m.userId, m]));
        const memberA = memberMap.get(match.user1Id);
        const memberB = memberMap.get(match.user2Id);
        if (!memberA || !memberB) {
            return res
                .status(400)
                .json({ message: 'Both match members must have approved community memberships' });
        }
        const meetingTimeMinutes = payload.meetingTime
            ? parseMeetingTimeToMinutes(payload.meetingTime)
            : null;
        const pairMeal = await prisma.pairMeal.create({
            data: {
                matchId: match.id,
                memberAId: memberA.id,
                memberBId: memberB.id,
                date: payload.date,
                timeBand: payload.timeBand,
                meetingTimeMinutes,
                placeName: payload.placeName != null ? payload.placeName.trim() : null,
                placeAddress: payload.placeAddress != null ? payload.placeAddress.trim() : null,
                placeLatitude: payload.latitude ?? null,
                placeLongitude: payload.longitude ?? null,
                placeGooglePlaceId: payload.googlePlaceId != null ? payload.googlePlaceId.trim() : null,
                restaurantName: payload.restaurantName != null ? payload.restaurantName.trim() : null,
                restaurantAddress: payload.restaurantAddress != null ? payload.restaurantAddress.trim() : null,
                status: PairMealStatus.CONFIRMED,
                createdByMemberId: membership.id
            }
        });
        return res.status(201).json({ pairMealId: pairMeal.id });
    }
    catch (err) {
        console.error('CREATE PAIR MEAL ERROR', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});
matchesRouter.patch('/:matchId/pair-meals/:pairMealId', async (req, res) => {
    try {
        const { matchId, pairMealId } = req.params;
        const parsed = pairMealUpdateSchema.safeParse(req.body);
        if (!parsed.success) {
            console.error('UPDATE PAIR MEAL INVALID BODY', parsed.error.format());
            return res.status(400).json({ message: 'Invalid input' });
        }
        const payload = parsed.data;
        const membership = await getApprovedMembership(req.user.userId);
        if (!membership) {
            return res.status(403).json({ message: 'Forbidden' });
        }
        const pairMeal = await prisma.pairMeal.findUnique({
            where: { id: pairMealId },
            include: { match: true }
        });
        if (!pairMeal || pairMeal.matchId !== matchId) {
            return res.status(404).json({ message: 'Not found' });
        }
        if (pairMeal.memberAId !== membership.id && pairMeal.memberBId !== membership.id) {
            return res.status(403).json({ message: 'Forbidden' });
        }
        let meetingTimeMinutes = pairMeal.meetingTimeMinutes;
        if (payload.meetingTime !== undefined) {
            meetingTimeMinutes =
                payload.meetingTime === null ? null : parseMeetingTimeToMinutes(payload.meetingTime);
        }
        const updated = await prisma.pairMeal.update({
            where: { id: pairMealId },
            data: {
                date: payload.date ?? pairMeal.date,
                timeBand: payload.timeBand ?? pairMeal.timeBand,
                meetingTimeMinutes,
                placeName: payload.placeName != null ? payload.placeName.trim() : pairMeal.placeName,
                placeAddress: payload.placeAddress != null
                    ? payload.placeAddress.trim()
                    : pairMeal.placeAddress,
                placeLatitude: payload.latitude !== undefined ? payload.latitude : pairMeal.placeLatitude,
                placeLongitude: payload.longitude !== undefined ? payload.longitude : pairMeal.placeLongitude,
                placeGooglePlaceId: payload.googlePlaceId != null
                    ? payload.googlePlaceId.trim()
                    : pairMeal.placeGooglePlaceId,
                restaurantName: payload.restaurantName != null
                    ? payload.restaurantName.trim()
                    : pairMeal.restaurantName,
                restaurantAddress: payload.restaurantAddress != null
                    ? payload.restaurantAddress.trim()
                    : pairMeal.restaurantAddress
            }
        });
        return res.json({ pairMealId: updated.id });
    }
    catch (err) {
        console.error('UPDATE PAIR MEAL ERROR', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});
matchesRouter.delete('/:matchId/pair-meals/:pairMealId', async (req, res) => {
    try {
        const { matchId, pairMealId } = req.params;
        const membership = await getApprovedMembership(req.user.userId);
        if (!membership) {
            return res.status(403).json({ message: 'Forbidden' });
        }
        const pairMeal = await prisma.pairMeal.findUnique({
            where: { id: pairMealId }
        });
        if (!pairMeal || pairMeal.matchId !== matchId) {
            return res.status(404).json({ message: 'Not found' });
        }
        if (pairMeal.memberAId !== membership.id && pairMeal.memberBId !== membership.id) {
            return res.status(403).json({ message: 'Forbidden' });
        }
        await prisma.pairMeal.update({
            where: { id: pairMealId },
            data: { status: PairMealStatus.CANCELLED }
        });
        return res.status(204).send();
    }
    catch (err) {
        console.error('DELETE PAIR MEAL ERROR', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});
function parseMeetingTimeToMinutes(value) {
    if (value == null) {
        return null;
    }
    const [hours, minutes] = value.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) {
        return null;
    }
    return hours * 60 + minutes;
}
