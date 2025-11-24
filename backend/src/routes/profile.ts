import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

const updateSchema = z.object({
  name: z.string().min(1),
  favoriteMeals: z
    .array(z.string().trim().min(1).max(100))
    .max(3)
});

export const profileRouter = Router();

profileRouter.use(authMiddleware);

profileRouter.get('/', async (req, res) => {
  const profile = await prisma.profile.findUnique({ where: { userId: req.user!.userId } });
  if (!profile) {
    return res.status(404).json({ message: 'Profile not found' });
  }
  res.json({
    id: profile.id,
    name: profile.name,
    favoriteMeals: profile.favoriteMeals ?? []
  });
});

profileRouter.put('/', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid input', issues: parsed.error.flatten() });
  }

  const profile = await prisma.profile.upsert({
    where: { userId: req.user!.userId },
    update: parsed.data,
    create: {
      userId: req.user!.userId,
      name: parsed.data.name,
      favoriteMeals: parsed.data.favoriteMeals
    }
  });

  res.json({
    id: profile.id,
    name: profile.name,
    favoriteMeals: profile.favoriteMeals ?? []
  });
});
