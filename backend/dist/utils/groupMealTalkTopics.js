function getTopEntries(map, limit) {
    return [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([value]) => value);
}
function getMostFrequentArea(profiles) {
    const areaCounts = new Map();
    for (const profile of profiles) {
        const area = profile.mainArea ?? profile.subAreas?.[0];
        if (!area)
            continue;
        areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);
    }
    let bestArea = null;
    let bestCount = 0;
    for (const [area, count] of areaCounts.entries()) {
        if (count > bestCount) {
            bestCount = count;
            bestArea = area;
        }
    }
    return bestArea;
}
export function buildTalkTopicsFromProfiles(profiles) {
    const validProfiles = profiles.filter((profile) => Boolean(profile));
    if (!validProfiles.length) {
        return [];
    }
    const hobbyCounts = new Map();
    const mealCounts = new Map();
    for (const profile of validProfiles) {
        for (const hobby of profile.hobbies ?? []) {
            const normalized = hobby.trim();
            if (!normalized)
                continue;
            hobbyCounts.set(normalized, (hobbyCounts.get(normalized) ?? 0) + 1);
        }
        for (const meal of profile.favoriteMeals ?? []) {
            const normalized = meal.trim();
            if (!normalized)
                continue;
            mealCounts.set(normalized, (mealCounts.get(normalized) ?? 0) + 1);
        }
    }
    const topics = [];
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
