import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../lib/prisma.js";

type GroupMealDbClient = Prisma.TransactionClient | PrismaClient;

export async function getGroupMealHeadcountTx(
  tx: GroupMealDbClient,
  groupMealId: string
): Promise<number> {
  return tx.groupMealParticipant.count({
    where: { groupMealId },
  });
}

export async function getGroupMealRemainingCapacityTx(
  tx: GroupMealDbClient,
  groupMealId: string
): Promise<number> {
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

export async function getGroupMealHeadcount(groupMealId: string) {
  return getGroupMealHeadcountTx(prisma, groupMealId);
}

export async function getGroupMealRemainingCapacity(groupMealId: string) {
  return getGroupMealRemainingCapacityTx(prisma, groupMealId);
}
