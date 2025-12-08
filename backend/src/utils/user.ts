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
  userId: string;
  name: string | null;
  favoriteMeals: string[];
  profileImageUrl: string | null;
  ngFoods: string[];
  areas: string[];
  hobbies: string[];
  mainArea: string | null;
  subAreas: string[];
  defaultBudget: GroupMealBudget | null;
  drinkingStyle: DrinkingStyle | null;
  mealStyle: MealStyle | null;
  goMealFrequency: GoMealFrequency | null;
  bio: string | null;
  completionRate: number;
};

export type UserPayload = {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  hasCompletedOnboarding: boolean;
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
    hasCompletedOnboarding: user.hasCompletedOnboarding,
    communityStatus,
    profile: user.profile ? buildProfileResponse(user.profile) : null
  };
}

function normalizeAreaList(entries: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of entries) {
    const trimmed = entry?.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

type ProfileWithAreas = Profile & { areas?: string[] };

export function getProfileAreas(profile: ProfileWithAreas): string[] {
  const persistedAreas = normalizeAreaList(profile.areas ?? []);
  if (persistedAreas.length > 0) {
    return persistedAreas;
  }
  return normalizeAreaList([
    ...(profile.mainArea ? [profile.mainArea] : []),
    ...(profile.subAreas ?? [])
  ]);
}

export function buildProfileResponse(profile: ProfileWithAreas): ProfileResponse {
  return {
    id: profile.id,
    userId: profile.userId,
    name: profile.name,
    favoriteMeals: profile.favoriteMeals ?? [],
    profileImageUrl: profile.profileImageUrl ?? null,
    areas: getProfileAreas(profile),
    hobbies: profile.hobbies ?? [],
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
