import { AvailabilityStatus, TimeSlot, Weekday } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
const ALL_WEEKDAYS = [
    Weekday.MON,
    Weekday.TUE,
    Weekday.WED,
    Weekday.THU,
    Weekday.FRI,
    Weekday.SAT,
    Weekday.SUN
];
const ALL_TIMESLOTS = [TimeSlot.DAY, TimeSlot.NIGHT];
/**
 * Fetch availability for two users and return a full grid of weekday x timeSlot availability booleans.
 * Missing records are treated as unavailable.
 */
export async function getPairAvailabilitySlots(selfUserId, partnerUserId) {
    const [selfSlots, partnerSlots] = await Promise.all([
        prisma.availabilitySlot.findMany({
            where: { userId: selfUserId },
            select: { weekday: true, timeSlot: true, status: true }
        }),
        prisma.availabilitySlot.findMany({
            where: { userId: partnerUserId },
            select: { weekday: true, timeSlot: true, status: true }
        })
    ]);
    const selfSet = new Set(selfSlots
        .filter((s) => s.status === AvailabilityStatus.AVAILABLE)
        .map((s) => `${s.weekday}-${s.timeSlot}`));
    const partnerSet = new Set(partnerSlots
        .filter((s) => s.status === AvailabilityStatus.AVAILABLE)
        .map((s) => `${s.weekday}-${s.timeSlot}`));
    const result = [];
    for (const weekday of ALL_WEEKDAYS) {
        for (const timeSlot of ALL_TIMESLOTS) {
            const key = `${weekday}-${timeSlot}`;
            result.push({
                weekday,
                timeSlot,
                selfAvailable: selfSet.has(key),
                partnerAvailable: partnerSet.has(key)
            });
        }
    }
    return result;
}
