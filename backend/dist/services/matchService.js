export async function createOrFindMatchIfReciprocalYes(params) {
    const { tx, communityId, fromUserId, toUserId } = params;
    const reciprocalYes = await tx.like.findFirst({
        where: {
            fromUserId: toUserId,
            toUserId: fromUserId,
            communityId,
            answer: 'YES'
        }
    });
    if (!reciprocalYes) {
        return null;
    }
    const [user1Id, user2Id] = [fromUserId, toUserId].sort();
    const matchRecord = await tx.match.upsert({
        where: {
            user1Id_user2Id_communityId: {
                user1Id,
                user2Id,
                communityId
            }
        },
        update: {},
        create: {
            user1Id,
            user2Id,
            communityId
        }
    });
    return matchRecord;
}
