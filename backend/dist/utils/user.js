import { prisma } from '../lib/prisma.js';
import { getCommunityStatus } from './membership.js';
import { computeProfileCompletion } from './profileCompletion.js';
export function toUserPayload(user, communityStatus) {
    return {
        id: user.id,
        name: user.profile?.name || '',
        email: user.email,
        isAdmin: user.isAdmin,
        communityStatus,
        profile: user.profile ? buildProfileResponse(user.profile) : null
    };
}
export function getProfileAreas(profile) {
    const areaCandidates = [
        ...(profile.mainArea ? [profile.mainArea] : []),
        ...(profile.subAreas ?? [])
    ];
    const seen = new Set();
    const areas = [];
    for (const entry of areaCandidates) {
        const trimmed = entry?.trim();
        if (!trimmed || seen.has(trimmed)) {
            continue;
        }
        seen.add(trimmed);
        areas.push(trimmed);
    }
    return areas;
}
export function buildProfileResponse(profile) {
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
