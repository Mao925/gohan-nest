import { AvailabilityStatus, GroupMealMode } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { getWeekdayForDate, mealTimeSlotToTimeSlot } from './availabilityHelpers.js';
async function fetchMembershipsWithProfiles(communityId) {
    return prisma.communityMembership.findMany({
        where: {
            communityId,
            status: 'approved'
        },
        include: {
            user: {
                include: {
                    profile: true
                }
            }
        }
    });
}
async function fetchAvailabilityRecords(userIds, weekday, timeSlot) {
    return prisma.availabilitySlot.findMany({
        where: {
            userId: { in: userIds },
            weekday,
            timeSlot
        },
        select: {
            userId: true,
            status: true
        }
    });
}
export async function getAvailabilitySplitForSlot(options) {
    const { communityId, date, mealTimeSlot } = options;
    const weekday = getWeekdayForDate(date);
    const timeSlot = mealTimeSlotToTimeSlot(mealTimeSlot);
    const memberships = await fetchMembershipsWithProfiles(communityId);
    if (memberships.length === 0) {
        return { available: [], meetOnly: [] };
    }
    const userIds = memberships.map((membership) => membership.userId);
    const availabilityRecords = await fetchAvailabilityRecords(userIds, weekday, timeSlot);
    const availabilityMap = new Map(availabilityRecords.map((record) => [record.userId, record.status]));
    const available = [];
    const meetOnly = [];
    for (const membership of memberships) {
        const status = availabilityMap.get(membership.userId);
        if (!status)
            continue;
        const candidate = {
            userId: membership.userId,
            membershipId: membership.id,
            communityId,
            availabilityStatus: status,
            profile: membership.user.profile
        };
        if (status === AvailabilityStatus.AVAILABLE) {
            available.push(candidate);
        }
        else if (status === AvailabilityStatus.MEET_ONLY) {
            meetOnly.push(candidate);
        }
    }
    return { available, meetOnly };
}
export async function getAutoGroupCandidatesForSlot(options) {
    const split = await getAvailabilitySplitForSlot(options);
    if (options.mode === GroupMealMode.REAL) {
        return split.available;
    }
    return [...split.available, ...split.meetOnly];
}
