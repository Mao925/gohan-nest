import { GroupMealParticipantStatus } from '@prisma/client';

export const ACTIVE_PARTICIPANT_STATUSES: GroupMealParticipantStatus[] = [
  GroupMealParticipantStatus.INVITED,
  GroupMealParticipantStatus.JOINED,
  GroupMealParticipantStatus.LATE,
];

export const ATTENDING_PARTICIPANT_STATUSES: GroupMealParticipantStatus[] = [
  GroupMealParticipantStatus.JOINED,
  GroupMealParticipantStatus.LATE,
];

export function getCountedParticipantsForGroupMeal(
  groupMeal: {
    hostUserId?: string | null;
    participants: {
      userId: string;
      status: GroupMealParticipantStatus;
      isCreator: boolean;
    }[];
  },
  includedStatuses: GroupMealParticipantStatus[] = ATTENDING_PARTICIPANT_STATUSES
) {
  const hostId = groupMeal.hostUserId;
  return groupMeal.participants.filter((participant) => {
    if (
      hostId &&
      participant.userId === hostId &&
      participant.isCreator !== true
    ) {
      return false;
    }

    return includedStatuses.includes(participant.status);
  });
}
