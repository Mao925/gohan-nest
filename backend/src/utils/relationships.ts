import type { Like, Match } from '@prisma/client';

type ProfileWithOptionalData = {
  id: string;
  profile: {
    name?: string | null;
    favoriteMeals?: string[] | null;
    profileImageUrl?: string | null;
  } | null;
};

export type MatchWithProfile = Match & {
  user1: ProfileWithOptionalData;
  user2: ProfileWithOptionalData;
};

export type LikeWithTargetProfile = Like & {
  toUser: ProfileWithOptionalData;
};

export type RelationshipCard = {
  id: string;
  relationshipId: string;
  targetUserId: string;
  name: string;
  favoriteMeals: string[];
  profileImageUrl: string | null;
  matched: boolean;
  myAnswer: 'YES' | 'NO';
  partnerAnswer: 'YES' | 'NO' | 'UNANSWERED';
  canToggleToYes: boolean;
  canToggleToNo: boolean;
  matchId?: string;
  matchedAt?: string;
};

export type RelationshipResponse = {
  matches: RelationshipCard[];
  awaitingResponse: RelationshipCard[];
  rejected: RelationshipCard[];
};

export type RelationshipSection = 'matches' | 'awaitingResponse' | 'rejected';

export function formatPartnerAnswer(answer?: 'YES' | 'NO'): 'YES' | 'NO' | 'UNANSWERED' {
  return answer ?? 'UNANSWERED';
}

export function determineNextSection(
  myAnswer: 'YES' | 'NO',
  matched: boolean
): RelationshipSection {
  if (matched) {
    return 'matches';
  }
  return myAnswer === 'YES' ? 'awaitingResponse' : 'rejected';
}

export function buildRelationshipPayload(params: {
  like: LikeWithTargetProfile;
  myAnswer: 'YES' | 'NO';
  partnerAnswer: 'YES' | 'NO' | 'UNANSWERED';
  matchRecord?: { id: string; createdAt: Date } | null;
}) {
  const matched = Boolean(params.matchRecord);
  const relationshipId = params.matchRecord?.id ?? params.like.id;
  const relationship: RelationshipCard = {
    id: relationshipId,
    relationshipId,
    targetUserId: params.like.toUserId,
    name: params.like.toUser.profile?.name || '',
    favoriteMeals: params.like.toUser.profile?.favoriteMeals || [],
    profileImageUrl: params.like.toUser.profile?.profileImageUrl ?? null,
    matched,
    myAnswer: params.myAnswer,
    partnerAnswer: params.partnerAnswer,
    matchId: params.matchRecord?.id,
    matchedAt: params.matchRecord ? params.matchRecord.createdAt.toISOString() : undefined,
    canToggleToYes: params.myAnswer === 'NO',
    canToggleToNo: params.myAnswer === 'YES' && !matched
  };
  const nextSection = determineNextSection(params.myAnswer, matched);
  return { relationship, nextSection };
}

export function buildRelationshipResponse(params: {
  userId: string;
  matches: MatchWithProfile[];
  likesFrom: LikeWithTargetProfile[];
  reverseLikes: Like[];
}): RelationshipResponse {
  const matchCards: RelationshipCard[] = params.matches.map((match) => {
    const isUser1 = match.user1Id === params.userId;
    const partner = isUser1 ? match.user2 : match.user1;
    const relationshipId = match.id;
    return {
      id: relationshipId,
      relationshipId,
      targetUserId: partner.id,
      matchId: match.id,
      name: partner.profile?.name || '',
      favoriteMeals: partner.profile?.favoriteMeals || [],
      profileImageUrl: partner.profile?.profileImageUrl ?? null,
      matchedAt: match.createdAt.toISOString(),
      myAnswer: 'YES',
      partnerAnswer: 'YES',
      matched: true,
      canToggleToNo: false,
      canToggleToYes: false
    };
  });

  const matchedUserIds = new Set(matchCards.map((summary) => summary.targetUserId));
  const reverseMap = new Map(params.reverseLikes.map((like) => [like.fromUserId, like]));

  const awaitingResponse: RelationshipCard[] = [];
  const rejected: RelationshipCard[] = [];

  for (const like of params.likesFrom) {
    const partnerAnswer = formatPartnerAnswer(reverseMap.get(like.toUserId)?.answer);
    const relationshipId = like.id;
    const summary: RelationshipCard = {
      id: relationshipId,
      relationshipId,
      targetUserId: like.toUserId,
      name: like.toUser.profile?.name || '',
      favoriteMeals: like.toUser.profile?.favoriteMeals || [],
      profileImageUrl: like.toUser.profile?.profileImageUrl ?? null,
      myAnswer: like.answer,
      partnerAnswer,
      matched: false,
      matchId: undefined,
      matchedAt: undefined,
      canToggleToYes: like.answer === 'NO',
      canToggleToNo: like.answer === 'YES' && !matchedUserIds.has(like.toUserId)
    };

    if (like.answer === 'YES' && !matchedUserIds.has(like.toUserId)) {
      awaitingResponse.push(summary);
    } else if (like.answer === 'NO') {
      rejected.push(summary);
    }
  }

  return {
    matches: matchCards,
    awaitingResponse,
    rejected
  };
}
