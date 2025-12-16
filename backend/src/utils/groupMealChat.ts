import { prisma } from '../lib/prisma.js';
import { ATTENDING_PARTICIPANT_STATUSES } from './groupMealParticipants.js';

export class GroupMealChatAccessError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GroupMealChatAccessError';
    this.status = status;
  }
}

type GroupMealAccessRecord = {
  id: string;
  communityId: string;
  hostUserId: string;
};

export async function assertCanAccessGroupMealChat(
  userId: string,
  groupMealId: string
): Promise<GroupMealAccessRecord> {
  const groupMeal = await prisma.groupMeal.findUnique({
    where: { id: groupMealId },
    select: { id: true, communityId: true, hostUserId: true },
  });

  if (!groupMeal) {
    throw new GroupMealChatAccessError(404, 'Group meal not found');
  }

  const isHost = groupMeal.hostUserId === userId;
  if (isHost) {
    return groupMeal;
  }

  const membership = await prisma.communityMembership.findFirst({
    where: {
      userId,
      communityId: groupMeal.communityId,
      status: 'approved',
    },
    select: { id: true },
  });
  if (!membership) {
    throw new GroupMealChatAccessError(
      403,
      'コミュニティ参加が承認されていません'
    );
  }

  const participant = await prisma.groupMealParticipant.findUnique({
    where: { groupMealId_userId: { groupMealId, userId } },
    select: { status: true },
  });
  if (!participant) {
    throw new GroupMealChatAccessError(
      403,
      'この箱に参加していません'
    );
  }

  if (!ATTENDING_PARTICIPANT_STATUSES.includes(participant.status)) {
    throw new GroupMealChatAccessError(
      403,
      '招待段階または参加が確定していないため、チャットに参加できません'
    );
  }

  return groupMeal;
}
