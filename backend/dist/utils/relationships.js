export function deriveReactionFlags(answer, superLikedByMe) {
    return {
        likedByMe: answer === 'YES' && !superLikedByMe,
        superLikedByMe
    };
}
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
    const reaction = deriveReactionFlags(params.myAnswer, params.superLikedByMe ?? false);
    const relationship = {
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
        canToggleToNo: params.myAnswer === 'YES' && !matched,
        likedByMe: reaction.likedByMe,
        superLikedByMe: reaction.superLikedByMe
    };
    const nextSection = determineNextSection(params.myAnswer, matched);
    return { relationship, nextSection };
}
export function buildRelationshipResponse(params) {
    const superLikedSet = params.superLikedUserIds ?? new Set();
    const matchCards = params.matches.map((match) => {
        const isUser1 = match.user1Id === params.userId;
        const partner = isUser1 ? match.user2 : match.user1;
        const relationshipId = match.id;
        const reaction = deriveReactionFlags('YES', superLikedSet.has(partner.id));
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
            canToggleToYes: false,
            likedByMe: reaction.likedByMe,
            superLikedByMe: reaction.superLikedByMe
        };
    });
    const matchedUserIds = new Set(matchCards.map((summary) => summary.targetUserId));
    const reverseMap = new Map(params.reverseLikes.map((like) => [like.fromUserId, like]));
    const awaitingResponse = [];
    const rejected = [];
    for (const like of params.likesFrom) {
        const partnerAnswer = formatPartnerAnswer(reverseMap.get(like.toUserId)?.answer);
        const relationshipId = like.id;
        const isSuperLiked = superLikedSet.has(like.toUserId);
        const reaction = deriveReactionFlags(like.answer, isSuperLiked);
        const summary = {
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
            canToggleToNo: like.answer === 'YES' && !matchedUserIds.has(like.toUserId),
            likedByMe: reaction.likedByMe,
            superLikedByMe: reaction.superLikedByMe
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
