import { Profile } from '@prisma/client';

function getMostFrequentValue(values: string[]): string | null {
  if (!values.length) {
    return null;
  }
  const counter = new Map<string, number>();
  for (const value of values) {
    counter.set(value, (counter.get(value) ?? 0) + 1);
  }
  let bestValue: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counter.entries()) {
    if (count > bestCount) {
      bestCount = count;
      bestValue = value;
    }
  }
  return bestValue;
}

export function computeGroupLocation(
  profiles: (Profile | null | undefined)[]
): {
  locationName: string | null;
  latitude?: number;
  longitude?: number;
} {
  const valid = profiles.filter((profile): profile is Profile => Boolean(profile));
  if (!valid.length) {
    return { locationName: null };
  }

  const areaCandidates = valid
    .map((profile) => profile.mainArea ?? profile.subAreas?.[0])
    .filter((area): area is string => Boolean(area));

  const locationName = getMostFrequentValue(areaCandidates);
  return { locationName: locationName ?? null };
}
