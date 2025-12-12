import { prisma } from "../lib/prisma.js";
export async function getGroupMealHeadcountTx(tx, groupMealId) {
    return tx.groupMealParticipant.count({
        where: { groupMealId },
    });
}
export async function getGroupMealRemainingCapacityTx(tx, groupMealId) {
    const groupMeal = await tx.groupMeal.findUnique({
        where: { id: groupMealId },
        select: { capacity: true },
    });
    if (!groupMeal) {
        throw new Error("Group meal not found");
    }
    const headcount = await getGroupMealHeadcountTx(tx, groupMealId);
    return Math.max(0, groupMeal.capacity - headcount);
}
export async function getGroupMealHeadcount(groupMealId) {
    return getGroupMealHeadcountTx(prisma, groupMealId);
}
export async function getGroupMealRemainingCapacity(groupMealId) {
    return getGroupMealRemainingCapacityTx(prisma, groupMealId);
}
