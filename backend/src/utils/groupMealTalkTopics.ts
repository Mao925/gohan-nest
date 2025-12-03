import { Profile } from '@prisma/client';

function getTopEntries(map: Map<string, number>, limit: number): string[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value]) => value);
}

function getMostFrequentArea(profiles: Profile[]): string | null {
  const areaCounts = new Map<string, number>();
  for (const profile of profiles) {
    const area = profile.mainArea ?? profile.subAreas?.[0];
    if (!area) continue;
    areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);
  }
  let bestArea: string | null = null;
  let bestCount = 0;
  for (const [area, count] of areaCounts.entries()) {
    if (count > bestCount) {
      bestCount = count;
      bestArea = area;
    }
  }
  return bestArea;
}

export function buildTalkTopicsFromProfiles(
  profiles: (Profile | null | undefined)[]
): string[] {
  const validProfiles = profiles.filter((profile): profile is Profile =>
    Boolean(profile)
  );
  if (!validProfiles.length) {
    return [];
  }

  const hobbyCounts = new Map<string, number>();
  const mealCounts = new Map<string, number>();

  for (const profile of validProfiles) {
    for (const hobby of profile.hobbies ?? []) {
      const normalized = hobby.trim();
      if (!normalized) continue;
      hobbyCounts.set(normalized, (hobbyCounts.get(normalized) ?? 0) + 1);
    }

    for (const meal of profile.favoriteMeals ?? []) {
      const normalized = meal.trim();
      if (!normalized) continue;
      mealCounts.set(normalized, (mealCounts.get(normalized) ?? 0) + 1);
    }
  }

  const topics: string[] = [];
  const topHobbies = getTopEntries(hobbyCounts, 2);
  if (topHobbies.length) {
    topics.push(`趣味: ${topHobbies.join('、')}`);
  }

  const topMeals = getTopEntries(mealCounts, 2);
  if (topMeals.length) {
    topics.push(`好きなご飯: ${topMeals.join('、')}`);
  }

  if (topics.length < 3) {
    const area = getMostFrequentArea(validProfiles);
    if (area) {
      topics.push(`よく行くエリア: ${area}`);
    }
  }

  return topics.slice(0, 3);
}
