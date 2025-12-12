import { GroupMealParticipantStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
export const OCCUPYING_PARTICIPANT_STATUSES = [
    GroupMealParticipantStatus.JOINED,
    GroupMealParticipantStatus.LATE,
];
export const INVITED_PARTICIPANT_STATUSES = [
    GroupMealParticipantStatus.INVITED,
];
const occupyingParticipantWhere = (groupMealId) => ({
    groupMealId,
    status: {
        in: OCCUPYING_PARTICIPANT_STATUSES,
    },
});
export async function getGroupMealHeadcountTx(tx, groupMealId) {
    return tx.groupMealParticipant.count({
        where: occupyingParticipantWhere(groupMealId),
    });
}
export async function getGroupMealRemainingCapacityTx(tx, groupMealId, opts) {
    const groupMeal = await tx.groupMeal.findUnique({
        where: { id: groupMealId },
        select: { id: true, capacity: true },
    });
    if (!groupMeal) {
        throw new Error("Group meal not found");
    }
    const headcount = typeof opts?.precomputedActiveCount === "number"
        ? opts.precomputedActiveCount
        : await getGroupMealHeadcountTx(tx, groupMealId);
    return Math.max(0, groupMeal.capacity - headcount);
}
export async function getGroupMealHeadcount(groupMealId) {
    return getGroupMealHeadcountTx(prisma, groupMealId);
}
export async function getGroupMealRemainingCapacity(groupMealId) {
    return getGroupMealRemainingCapacityTx(prisma, groupMealId);
}
