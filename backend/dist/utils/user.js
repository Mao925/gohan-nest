import { prisma } from '../lib/prisma.js';
import { getCommunityStatus } from './membership.js';
export function toUserPayload(user, communityStatus) {
    return {
        id: user.id,
        name: user.profile?.name || '',
        email: user.email,
        isAdmin: user.isAdmin,
        communityStatus,
        profile: user.profile
    };
}
export async function buildUserPayload(userId) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { profile: true }
    });
    if (!user) {
        throw new Error('User not found');
    }
    const { communityStatus } = await getCommunityStatus(userId);
    return toUserPayload(user, communityStatus);
}
