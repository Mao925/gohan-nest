import crypto from 'node:crypto';
import { Router } from 'express';
import { GroupMealMode, MealTimeSlot, GroupMealStatus, GroupMealParticipantStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { getAvailabilitySplitForSlot } from '../utils/groupMealAutoCandidates.js';
import { groupCandidatesIntoBoxes } from '../utils/groupMealAutoGrouping.js';
import { computeGroupLocation } from '../utils/groupMealLocation.js';
import { buildTalkTopicsFromProfiles } from '../utils/groupMealTalkTopics.js';
import { computeExpiresAt, mealTimeSlotToTimeSlot, startOfDayForDate, getWeekdayForDate } from '../utils/availabilityHelpers.js';
import { pushRealGroupMealInvite, pushMeetGroupMealInvite } from '../lib/lineGroupMeals.js';
import { CLIENT_ORIGIN, FRONTEND_URL } from '../config.js';
const autoGroupMealsRouter = Router();
async function getTargetCommunityIds() {
    const communities = await prisma.community.findMany({ select: { id: true } });
    return communities.map((community) => community.id);
}
const MEAL_TIME_SLOTS = [MealTimeSlot.LUNCH, MealTimeSlot.DINNER];
async function createRealGroupMealsForCommunity(communityId, date) {
    const weekday = getWeekdayForDate(date);
    const meetingDate = startOfDayForDate(date);
    const expiresCache = {
        [MealTimeSlot.LUNCH]: computeExpiresAt(date, MealTimeSlot.LUNCH),
        [MealTimeSlot.DINNER]: computeExpiresAt(date, MealTimeSlot.DINNER)
    };
    for (const mealTimeSlot of MEAL_TIME_SLOTS) {
        const { available } = await getAvailabilitySplitForSlot({
            communityId,
            date,
            mealTimeSlot
        });
        if (available.length < 2) {
            continue;
        }
        const groups = await groupCandidatesIntoBoxes({
            candidates: available,
            communityId,
            mode: GroupMealMode.REAL
        });
        if (!groups.length) {
            continue;
        }
        const timeSlot = mealTimeSlotToTimeSlot(mealTimeSlot);
        const expiresAt = expiresCache[mealTimeSlot];
        const candidateMap = new Map(available.map((candidate) => [candidate.userId, candidate]));
        for (const group of groups) {
            const groupMembers = group.userIds
                .map((userId) => candidateMap.get(userId))
                .filter((candidate) => Boolean(candidate));
            if (groupMembers.length < 2) {
                continue;
            }
            const host = groupMembers[0];
            const profiles = groupMembers.map((member) => member.profile);
            const { locationName, latitude, longitude } = computeGroupLocation(profiles);
            const participantCreates = groupMembers.map((member, index) => ({
                userId: member.userId,
                isHost: index === 0,
                status: GroupMealParticipantStatus.PENDING
            }));
            const groupMeal = await prisma.groupMeal.create({
                data: {
                    communityId: host.communityId,
                    hostUserId: host.userId,
                    hostMembershipId: host.membershipId,
                    title: 'リアルでGO飯',
                    date: meetingDate,
                    weekday,
                    timeSlot,
                    mode: GroupMealMode.REAL,
                    mealTimeSlot,
                    locationName: locationName ?? undefined,
                    latitude,
                    longitude,
                    capacity: groupMembers.length,
                    status: GroupMealStatus.OPEN,
                    createdById: host.userId,
                    expiresAt,
                    talkTopics: [],
                    participants: {
                        create: participantCreates
                    }
                },
                include: {
                    participants: {
                        include: {
                            user: {
                                include: {
                                    profile: true
                                }
                            }
                        }
                    }
                }
            });
            await pushRealGroupMealInvite(groupMeal);
        }
    }
}
async function createMeetGroupMealsForCommunity(communityId, date) {
    const weekday = getWeekdayForDate(date);
    const meetingDate = startOfDayForDate(date);
    const expiresCache = {
        [MealTimeSlot.LUNCH]: computeExpiresAt(date, MealTimeSlot.LUNCH),
        [MealTimeSlot.DINNER]: computeExpiresAt(date, MealTimeSlot.DINNER)
    };
    for (const mealTimeSlot of MEAL_TIME_SLOTS) {
        const { available, meetOnly } = await getAvailabilitySplitForSlot({
            communityId,
            date,
            mealTimeSlot
        });
        const realCandidateCount = available.length;
        const meetCandidates = realCandidateCount >= 2 ? meetOnly : [...available, ...meetOnly];
        if (meetCandidates.length < 2) {
            continue;
        }
        const groups = await groupCandidatesIntoBoxes({
            candidates: meetCandidates,
            communityId,
            mode: GroupMealMode.MEET
        });
        if (!groups.length) {
            continue;
        }
        const timeSlot = mealTimeSlotToTimeSlot(mealTimeSlot);
        const expiresAt = expiresCache[mealTimeSlot];
        const candidateMap = new Map(meetCandidates.map((candidate) => [candidate.userId, candidate]));
        const frontendBase = (FRONTEND_URL || CLIENT_ORIGIN || 'https://gohan-expo.vercel.app').replace(/\/$/, '');
        for (const group of groups) {
            const groupMembers = group.userIds
                .map((userId) => candidateMap.get(userId))
                .filter((candidate) => Boolean(candidate));
            if (groupMembers.length < 2) {
                continue;
            }
            const host = groupMembers[0];
            const profiles = groupMembers.map((member) => member.profile);
            const talkTopics = buildTalkTopicsFromProfiles(profiles);
            const meetId = crypto.randomUUID();
            const meetUrl = `${frontendBase}/meet/${meetId}`;
            const participantCreates = groupMembers.map((member, index) => ({
                userId: member.userId,
                isHost: index === 0,
                status: GroupMealParticipantStatus.PENDING
            }));
            const groupMeal = await prisma.groupMeal.create({
                data: {
                    communityId: host.communityId,
                    hostUserId: host.userId,
                    hostMembershipId: host.membershipId,
                    title: 'MeetでGO飯',
                    date: meetingDate,
                    weekday,
                    timeSlot,
                    mode: GroupMealMode.MEET,
                    mealTimeSlot,
                    locationName: 'Online',
                    meetUrl,
                    talkTopics,
                    capacity: groupMembers.length,
                    status: GroupMealStatus.OPEN,
                    createdById: host.userId,
                    expiresAt,
                    participants: {
                        create: participantCreates
                    }
                },
                include: {
                    participants: {
                        include: {
                            user: {
                                include: {
                                    profile: true
                                }
                            }
                        }
                    }
                }
            });
            await pushMeetGroupMealInvite(groupMeal);
        }
    }
}
autoGroupMealsRouter.post('/real', async (req, res) => {
    try {
        const today = new Date();
        const communityIds = await getTargetCommunityIds();
        await Promise.all(communityIds.map((communityId) => createRealGroupMealsForCommunity(communityId, today)));
        return res.status(204).send();
    }
    catch (error) {
        console.error('[auto-group-meals] /real failed', error);
        return res.status(500).json({ message: 'Failed to create real group meals' });
    }
});
autoGroupMealsRouter.post('/meet', async (req, res) => {
    try {
        const today = new Date();
        const communityIds = await getTargetCommunityIds();
        await Promise.all(communityIds.map((communityId) => createMeetGroupMealsForCommunity(communityId, today)));
        return res.status(204).send();
    }
    catch (error) {
        console.error('[auto-group-meals] /meet failed', error);
        return res.status(500).json({ message: 'Failed to create meet group meals' });
    }
});
export { autoGroupMealsRouter };
