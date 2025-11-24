export function formatPartnerAnswer(answer) {
    return answer ?? 'UNANSWERED';
}
export function determineNextSection(myAnswer, matched) {
    if (matched) {
        return 'matches';
    }
    return myAnswer === 'YES' ? 'awaitingResponse' : 'rejected';
}
export function buildRelationshipPayload(params) {
    const matched = Boolean(params.matchRecord);
    const relationshipId = params.matchRecord?.id ?? params.like.id;
    const relationship = {
        id: relationshipId,
        relationshipId,
        targetUserId: params.like.toUserId,
        name: params.like.toUser.profile?.name || '',
        favoriteMeals: params.like.toUser.profile?.favoriteMeals || [],
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
export function buildRelationshipResponse(params) {
    const matchCards = params.matches.map((match) => {
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
    const awaitingResponse = [];
    const rejected = [];
    for (const like of params.likesFrom) {
        const partnerAnswer = formatPartnerAnswer(reverseMap.get(like.toUserId)?.answer);
        const relationshipId = like.id;
        const summary = {
            id: relationshipId,
            relationshipId,
            targetUserId: like.toUserId,
            name: like.toUser.profile?.name || '',
            favoriteMeals: like.toUser.profile?.favoriteMeals || [],
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
        }
        else if (like.answer === 'NO') {
            rejected.push(summary);
        }
    }
    return {
        matches: matchCards,
        awaitingResponse,
        rejected
    };
}
