import type { MembershipStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AUTO_APPROVE_MEMBERS, DEFAULT_COMMUNITY_CODE } from '../config.js';

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

async function ensureAutoApprovedMembership(userId: string) {
  if (!AUTO_APPROVE_MEMBERS) return null;
  const community = await prisma.community.findUnique({ where: { inviteCode: DEFAULT_COMMUNITY_CODE } });
  if (!community) return null;
  return prisma.communityMembership.upsert({
    where: { userId_communityId: { userId, communityId: community.id } },
    update: { status: 'approved' },
    create: { userId, communityId: community.id, status: 'approved' },
    include: { community: true }
  });
}

async function promoteIfNeeded(membershipId: string) {
  if (!AUTO_APPROVE_MEMBERS) return null;
  return prisma.communityMembership.update({
    where: { id: membershipId },
    data: { status: 'approved' },
    include: { community: true }
  });
}

export async function getLatestMembership(userId: string) {
  const membership = await prisma.communityMembership.findFirst({
    where: { userId },
    include: { community: true },
    orderBy: { createdAt: 'desc' }
  });
  if (membership) {
    if (membership.status !== 'approved') {
      const promoted = await promoteIfNeeded(membership.id);
      if (promoted) return promoted;
    }
    return membership;
  }
  return ensureAutoApprovedMembership(userId);
}

export async function getApprovedMembership(userId: string) {
  const membership = await prisma.communityMembership.findFirst({
    where: { userId, status: 'approved' },
    include: { community: true },
    orderBy: { createdAt: 'desc' }
  });
  if (membership) return membership;
  return ensureAutoApprovedMembership(userId);
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
