import type { GroupMeal } from '@prisma/client';
import type { JwtPayload } from '../utils/jwt.js';

export type CreatorAwareGroupMeal = Pick<GroupMeal, 'createdByUserId'>;

export function canManageGroupMeal(args: {
  user: JwtPayload;
  groupMeal: CreatorAwareGroupMeal;
}): boolean {
  if (args.user.isAdmin) {
    return true;
  }
  return Boolean(
    args.groupMeal.createdByUserId &&
      args.groupMeal.createdByUserId === args.user.userId
  );
}
