export function computeProfileCompletion(profile) {
    const checks = [
        !!profile.profileImageUrl,
        !!profile.name?.trim(),
        (profile.favoriteMeals ?? []).length > 0,
        !!profile.mainArea?.trim(),
        !!profile.defaultBudget,
        !!profile.bio?.trim(),
        !!profile.drinkingStyle,
        !!profile.mealStyle,
        !!profile.goMealFrequency,
        (profile.ngFoods ?? []).length > 0
    ];
    const total = checks.length;
    const completed = checks.filter(Boolean).length;
    if (total === 0) {
        return 0;
    }
    const raw = (completed / total) * 100;
    const rounded = Math.round(raw / 10) * 10;
    return Math.max(0, Math.min(100, rounded));
}
