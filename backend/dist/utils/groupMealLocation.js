function getMostFrequentValue(values) {
    if (!values.length) {
        return null;
    }
    const counter = new Map();
    for (const value of values) {
        counter.set(value, (counter.get(value) ?? 0) + 1);
    }
    let bestValue = null;
    let bestCount = 0;
    for (const [value, count] of counter.entries()) {
        if (count > bestCount) {
            bestCount = count;
            bestValue = value;
        }
    }
    return bestValue;
}
export function computeGroupLocation(profiles) {
    const valid = profiles.filter((profile) => Boolean(profile));
    if (!valid.length) {
        return { locationName: null };
    }
    const areaCandidates = valid
        .map((profile) => profile.mainArea ?? profile.subAreas?.[0])
        .filter((area) => Boolean(area));
    const locationName = getMostFrequentValue(areaCandidates);
    return { locationName: locationName ?? null };
}
