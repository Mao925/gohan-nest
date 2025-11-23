import { prisma } from '../lib/prisma.js';
export function mapCommunityStatus(status) {
    if (status === 'approved') {
        return 'APPROVED';
    }
    if (status === 'pending') {
        return 'PENDING';
    }
    return 'UNAPPLIED';
}
export async function getLatestMembership(userId) {
    const membership = await prisma.communityMembership.findFirst({
        where: { userId },
        include: { community: true },
        orderBy: { createdAt: 'desc' }
    });
    return membership;
}
export async function getApprovedMembership(userId) {
    const membership = await prisma.communityMembership.findFirst({
        where: { userId, status: 'approved' },
        include: { community: true },
        orderBy: { createdAt: 'desc' }
    });
    return membership;
}
export async function getCommunityStatus(userId) {
    const membership = await getLatestMembership(userId);
    return {
        communityStatus: mapCommunityStatus(membership?.status ?? null),
        membership
    };
}
export async function ensureSameCommunity(userId, targetUserId, communityId) {
    const target = await prisma.communityMembership.findFirst({
        where: { userId: targetUserId, communityId, status: 'approved' }
    });
    if (!target) {
        throw new Error('対象ユーザーは同じコミュニティの承認済みメンバーではありません');
    }
    if (userId === targetUserId) {
        throw new Error('自分自身には回答できません');
    }
}
