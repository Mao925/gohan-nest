import type { Prisma, PrismaClient } from "@prisma/client";
import { GroupMealParticipantStatus } from "@prisma/client";

import { prisma } from "../lib/prisma.js";

type GroupMealDbClient = Prisma.TransactionClient | PrismaClient;

const activeParticipantWhere = (groupMealId: string): Prisma.GroupMealParticipantWhereInput => ({
  groupMealId,
  status: {
    notIn: [
      GroupMealParticipantStatus.CANCELLED,
      GroupMealParticipantStatus.DECLINED,
    ],
  },
});

export async function getGroupMealHeadcountTx(
  tx: GroupMealDbClient,
  groupMealId: string
): Promise<number> {
  return tx.groupMealParticipant.count({
    where: activeParticipantWhere(groupMealId),
  });
}

export async function getGroupMealRemainingCapacityTx(
  tx: GroupMealDbClient,
  groupMealId: string,
  activeCount?: number
): Promise<number> {
  const groupMeal = await tx.groupMeal.findUnique({
    where: { id: groupMealId },
    select: { capacity: true },
  });

  if (!groupMeal) {
    throw new Error("Group meal not found");
  }

  const headcount = activeCount ?? (await getGroupMealHeadcountTx(tx, groupMealId));
  return Math.max(0, groupMeal.capacity - headcount);
}

export async function getGroupMealHeadcount(groupMealId: string) {
  return getGroupMealHeadcountTx(prisma, groupMealId);
}

export async function getGroupMealRemainingCapacity(groupMealId: string) {
  return getGroupMealRemainingCapacityTx(prisma, groupMealId);
}
