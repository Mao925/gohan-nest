import type { Profile, User } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { CommunityStatus, getCommunityStatus } from './membership.js';

export type UserPayload = {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  communityStatus: CommunityStatus;
  profile: Profile | null;
};

type UserWithProfile = User & { profile: Profile | null };

export function toUserPayload(user: UserWithProfile, communityStatus: CommunityStatus): UserPayload {
  return {
    id: user.id,
    name: user.profile?.name || '',
    email: user.email,
    isAdmin: user.isAdmin,
    communityStatus,
    profile: user.profile
  };
}

export async function buildUserPayload(userId: string): Promise<UserPayload> {
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
