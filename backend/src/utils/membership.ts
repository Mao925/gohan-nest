import type { MembershipStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export type CommunityStatus = 'UNAPPLIED' | 'PENDING' | 'APPROVED';

export function mapCommunityStatus(status?: MembershipStatus | null): CommunityStatus {
  if (status === 'approved') {
    return 'APPROVED';
  }
  if (status === 'pending') {
    return 'PENDING';
  }
  return 'UNAPPLIED';
}

export async function getLatestMembership(userId: string) {
  const membership = await prisma.communityMembership.findFirst({
    where: { userId },
    include: { community: true },
    orderBy: { createdAt: 'desc' }
  });
  return membership;
}

export async function getApprovedMembership(userId: string) {
  const membership = await prisma.communityMembership.findFirst({
    where: { userId, status: 'approved' },
    include: { community: true },
    orderBy: { createdAt: 'desc' }
  });
  return membership;
}

export async function getCommunityStatus(userId: string) {
  const membership = await getLatestMembership(userId);
  return {
    communityStatus: mapCommunityStatus(membership?.status ?? null),
    membership
  };
}

export async function ensureSameCommunity(userId: string, targetUserId: string, communityId: string) {
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
