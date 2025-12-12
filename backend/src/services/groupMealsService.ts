import type { Prisma, PrismaClient } from "@prisma/client";
import { GroupMealParticipantStatus } from "@prisma/client";

import { prisma } from "../lib/prisma.js";

type GroupMealDbClient = Prisma.TransactionClient | PrismaClient;

export const OCCUPYING_PARTICIPANT_STATUSES: GroupMealParticipantStatus[] = [
  GroupMealParticipantStatus.JOINED,
  GroupMealParticipantStatus.LATE,
];

export const INVITED_PARTICIPANT_STATUSES: GroupMealParticipantStatus[] = [
  GroupMealParticipantStatus.INVITED,
];

const occupyingParticipantWhere = (
  groupMealId: string
): Prisma.GroupMealParticipantWhereInput => ({
  groupMealId,
  status: {
    in: OCCUPYING_PARTICIPANT_STATUSES,
  },
});

export async function getGroupMealHeadcountTx(
  tx: GroupMealDbClient,
  groupMealId: string
): Promise<number> {
  return tx.groupMealParticipant.count({
    where: occupyingParticipantWhere(groupMealId),
  });
}

export async function getGroupMealRemainingCapacityTx(
  tx: GroupMealDbClient,
  groupMealId: string,
  opts?: { precomputedActiveCount?: number }
): Promise<number> {
  const groupMeal = await tx.groupMeal.findUnique({
    where: { id: groupMealId },
    select: { id: true, capacity: true },
  });

  if (!groupMeal) {
    throw new Error("Group meal not found");
  }

  const headcount =
    typeof opts?.precomputedActiveCount === "number"
      ? opts.precomputedActiveCount
      : await getGroupMealHeadcountTx(tx, groupMealId);
  return Math.max(0, groupMeal.capacity - headcount);
}

export async function getGroupMealHeadcount(groupMealId: string) {
  return getGroupMealHeadcountTx(prisma, groupMealId);
}

export async function getGroupMealRemainingCapacity(groupMealId: string) {
  return getGroupMealRemainingCapacityTx(prisma, groupMealId);
}
