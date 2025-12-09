export function canManageGroupMeal(args) {
    if (args.user.isAdmin) {
        return true;
    }
    return Boolean(args.groupMeal.createdByUserId &&
        args.groupMeal.createdByUserId === args.user.userId);
}
