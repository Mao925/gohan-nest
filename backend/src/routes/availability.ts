import { Router } from 'express';
import { z } from 'zod';
import { AvailabilityStatus, TimeSlot, Weekday } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

const availabilitySchema = z.array(
  z.object({
    weekday: z.nativeEnum(Weekday),
    timeSlot: z.nativeEnum(TimeSlot),
    status: z.nativeEnum(AvailabilityStatus)
  })
);

export const availabilityRouter = Router();

availabilityRouter.use(authMiddleware);

// admin ユーザーには提供しない API なのでここで弾く
availabilityRouter.use((req, res, next) => {
  if (req.user?.isAdmin) {
    return res.status(403).json({ message: '一般ユーザーのみ利用できます' });
  }
  next();
});

availabilityRouter.get('/', async (req, res) => {
  try {
    const slots = await prisma.availabilitySlot.findMany({
      where: { userId: req.user!.userId },
      select: { weekday: true, timeSlot: true, status: true },
      orderBy: [{ weekday: 'asc' }, { timeSlot: 'asc' }]
    });
    return res.json(slots);
  } catch (error) {
    console.error('FETCH AVAILABILITY ERROR:', error);
    return res.status(500).json({ message: 'Failed to fetch availability' });
  }
});

availabilityRouter.put('/', async (req, res) => {
  const parsed = availabilitySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid input', issues: parsed.error.flatten() });
  }

  const seen = new Set<string>();
  for (const slot of parsed.data) {
    const key = `${slot.weekday}-${slot.timeSlot}`;
    if (seen.has(key)) {
      return res
        .status(400)
        .json({ message: 'weekday と timeSlot の組み合わせは重複できません' });
    }
    seen.add(key);
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.availabilitySlot.deleteMany({ where: { userId: req.user!.userId } });
      if (parsed.data.length === 0) {
        return;
      }
      await tx.availabilitySlot.createMany({
        data: parsed.data.map((slot) => ({
          ...slot,
          userId: req.user!.userId
        }))
      });
    });

    const slots = await prisma.availabilitySlot.findMany({
      where: { userId: req.user!.userId },
      select: { weekday: true, timeSlot: true, status: true },
      orderBy: [{ weekday: 'asc' }, { timeSlot: 'asc' }]
    });
    return res.json(slots);
  } catch (error) {
    console.error('UPSERT AVAILABILITY ERROR:', error);
    return res.status(500).json({ message: 'Failed to update availability' });
  }
});
