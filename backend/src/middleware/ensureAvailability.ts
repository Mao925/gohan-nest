import { Request, Response, NextFunction } from 'express';
import { countUserAvailableSlots, MIN_REQUIRED_AVAILABILITY } from '../utils/availability.js';

export async function ensureSufficientAvailability(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> {
  const userId = req.user?.userId;
  if (!userId) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  const availableCount = await countUserAvailableSlots(userId);
  if (availableCount < MIN_REQUIRED_AVAILABILITY) {
    return res.status(403).json({
      code: 'INSUFFICIENT_AVAILABILITY',
      message:
        '空いている日程を3つ以上登録すると、マッチ相手を確認できるようになります。',
      availableCount,
      required: MIN_REQUIRED_AVAILABILITY
    });
  }

  next();
}
