import type {
  GroupMealBudget,
  Profile,
  User,
  DrinkingStyle,
  MealStyle,
  GoMealFrequency
} from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { CommunityStatus, getCommunityStatus } from './membership.js';
import { computeProfileCompletion } from './profileCompletion.js';

export type ProfileResponse = {
  id: string;
  name: string | null;
  favoriteMeals: string[];
  profileImageUrl: string | null;
  mainArea: string | null;
  subAreas: string[];
  defaultBudget: GroupMealBudget | null;
  drinkingStyle: DrinkingStyle | null;
  ngFoods: string[];
  bio: string | null;
  mealStyle: MealStyle | null;
  goMealFrequency: GoMealFrequency | null;
  completionRate: number;
};

export type UserPayload = {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  communityStatus: CommunityStatus;
  profile: ProfileResponse | null;
};

type UserWithProfile = User & { profile: Profile | null };

export function toUserPayload(user: UserWithProfile, communityStatus: CommunityStatus): UserPayload {
  return {
    id: user.id,
    name: user.profile?.name || '',
    email: user.email,
    isAdmin: user.isAdmin,
    communityStatus,
    profile: user.profile ? buildProfileResponse(user.profile) : null
  };
}

export function buildProfileResponse(profile: Profile): ProfileResponse {
  return {
    id: profile.id,
    name: profile.name,
    favoriteMeals: profile.favoriteMeals ?? [],
    profileImageUrl: profile.profileImageUrl ?? null,
    mainArea: profile.mainArea ?? null,
    subAreas: profile.subAreas ?? [],
    defaultBudget: profile.defaultBudget ?? null,
    drinkingStyle: profile.drinkingStyle ?? null,
    ngFoods: profile.ngFoods ?? [],
    bio: profile.bio ?? null,
    mealStyle: profile.mealStyle ?? null,
    goMealFrequency: profile.goMealFrequency ?? null,
    completionRate: computeProfileCompletion(profile)
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
