// backend/src/routes/profile.ts
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

const updateSchema = z.object({
  name: z.string().min(1),
  favoriteMeals: z
    .array(z.string().trim().min(1).max(100))
    .max(3),
  // フロントで生成した Base64(Data URL) を文字列として受け取る
  profileImageUrl: z
    .string()
    .trim()
    .max(500_000) // ざっくり50〜200KB程度を想定（必要なら増やしてOK）
    .optional()
    .nullable(),
});

export const profileRouter = Router();

profileRouter.use(authMiddleware);

profileRouter.get('/', async (req, res) => {
  const profile = await prisma.profile.findUnique({
    where: { userId: req.user!.userId },
  });

  if (!profile) {
    return res.status(404).json({ message: 'Profile not found' });
  }

  res.json({
    id: profile.id,
    name: profile.name,
    favoriteMeals: profile.favoriteMeals ?? [],
    profileImageUrl: profile.profileImageUrl ?? null,
  });
});

profileRouter.put('/', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid input',
      issues: parsed.error.flatten(),
    });
  }

  const { name, favoriteMeals, profileImageUrl } = parsed.data;

  const updateData: any = {
    name,
    favoriteMeals,
  };

  // profileImageUrl が送られてきたときだけ更新対象にする
  if (typeof profileImageUrl !== 'undefined') {
    // 空文字 or null は「削除」として扱う
    updateData.profileImageUrl =
      profileImageUrl && profileImageUrl.length > 0 ? profileImageUrl : null;
  }

  const profile = await prisma.profile.upsert({
    where: { userId: req.user!.userId },
    update: updateData,
    create: {
      userId: req.user!.userId,
      ...updateData,
    },
  });

  res.json({
    id: profile.id,
    name: profile.name,
    favoriteMeals: profile.favoriteMeals ?? [],
    profileImageUrl: profile.profileImageUrl ?? null,
  });
});
