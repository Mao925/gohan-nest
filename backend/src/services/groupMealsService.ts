import type { Prisma, PrismaClient } from "@prisma/client";
import {
  GroupMealParticipantStatus,
  GroupMealStatus,
} from "@prisma/client";

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
  groupMealId: string,
  hostUserId?: string | null
): Prisma.GroupMealParticipantWhereInput => {
  const where: Prisma.GroupMealParticipantWhereInput = {
    groupMealId,
    status: {
      in: OCCUPYING_PARTICIPANT_STATUSES,
    },
  };

  if (hostUserId) {
    where.OR = [
      { userId: { not: hostUserId } },
      { userId: hostUserId, isCreator: true },
    ];
  }

  return where;
};

type GetGroupMealHeadcountOpts = {
  hostUserId?: string | null;
};

export async function getGroupMealHeadcountTx(
  tx: GroupMealDbClient,
  groupMealId: string,
  opts?: GetGroupMealHeadcountOpts
): Promise<number> {
  let hostUserId = opts?.hostUserId;

  if (hostUserId === undefined) {
    const groupMeal = await tx.groupMeal.findUnique({
      where: { id: groupMealId },
      select: { hostUserId: true },
    });
    if (!groupMeal) {
      throw new Error("Group meal not found");
    }
    hostUserId = groupMeal.hostUserId;
  }

  return tx.groupMealParticipant.count({
    where: occupyingParticipantWhere(groupMealId, hostUserId),
  });
}

type GetGroupMealRemainingCapacityOpts = {
  precomputedHeadcount?: number;
  hostUserId?: string | null;
};

export async function getGroupMealRemainingCapacityTx(
  tx: GroupMealDbClient,
  groupMealId: string,
  opts?: GetGroupMealRemainingCapacityOpts
): Promise<number> {
  const groupMeal = await tx.groupMeal.findUnique({
    where: { id: groupMealId },
    select: { id: true, capacity: true, hostUserId: true },
  });

  if (!groupMeal) {
    throw new Error("Group meal not found");
  }

  const headcount =
    typeof opts?.precomputedHeadcount === "number"
      ? opts.precomputedHeadcount
      : await getGroupMealHeadcountTx(tx, groupMealId, {
          hostUserId: opts?.hostUserId ?? groupMeal.hostUserId,
        });

  return Math.max(0, groupMeal.capacity - headcount);
}

type RecomputeGroupMealStatusResult = {
  status: GroupMealStatus;
  headcount: number;
  remainingCapacity: number;
};

export async function recomputeAndUpdateGroupMealStatusTx(
  tx: GroupMealDbClient,
  groupMealId: string
): Promise<RecomputeGroupMealStatusResult> {
  const groupMeal = await tx.groupMeal.findUnique({
    where: { id: groupMealId },
    select: {
      id: true,
      capacity: true,
      status: true,
      hostUserId: true,
    },
  });

  if (!groupMeal) {
    throw new Error("Group meal not found");
  }

  const headcount = await getGroupMealHeadcountTx(tx, groupMealId, {
    hostUserId: groupMeal.hostUserId,
  });
  const remainingCapacity = Math.max(0, groupMeal.capacity - headcount);

  let nextStatus: GroupMealStatus;
  if (groupMeal.status === GroupMealStatus.CLOSED) {
    nextStatus = GroupMealStatus.CLOSED;
  } else if (remainingCapacity <= 0) {
    nextStatus = GroupMealStatus.FULL;
  } else {
    nextStatus = GroupMealStatus.OPEN;
  }

  if (nextStatus !== groupMeal.status) {
    await tx.groupMeal.update({
      where: { id: groupMealId },
      data: { status: nextStatus },
    });
  }

  return {
    status: nextStatus,
    headcount,
    remainingCapacity,
  };
}

export async function getGroupMealHeadcount(groupMealId: string) {
  return getGroupMealHeadcountTx(prisma, groupMealId);
}

export async function getGroupMealRemainingCapacity(groupMealId: string) {
  return getGroupMealRemainingCapacityTx(prisma, groupMealId);
}
