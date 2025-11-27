import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { uploadProfileImage, deleteProfileImageByUrl } from '../services/profileImageStorage.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: (Number(process.env.PROFILE_IMAGE_MAX_SIZE_MB) || 5) * 1024 * 1024
  }
});

const updateSchema = z.object({
  name: z.string().min(1),
  favoriteMeals: z
    .array(z.string().trim().min(1).max(100))
    .max(3),
  profileImageUrl: z
    .string()
    .trim()
    .max(500)
    .url()
    .refine((val) => val.startsWith('https://'), {
      message: 'profileImageUrl must be a https URL'
    })
    .nullable()
    .optional()
});

const profileImageSchema = z.object({
  profileImageUrl: z
    .string()
    .trim()
    .max(500)
    .url()
    .refine((val) => val.startsWith('https://'), {
      message: 'profileImageUrl must be a https URL'
    })
    .nullable()
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
    favoriteMeals: profile.favoriteMeals ?? [],
    profileImageUrl: profile.profileImageUrl ?? null
  });
});

profileRouter.put('/', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid input', issues: parsed.error.flatten() });
  }

  const profile = await prisma.profile.upsert({
    where: { userId: req.user!.userId },
    update: {
      name: parsed.data.name,
      favoriteMeals: parsed.data.favoriteMeals,
      ...(parsed.data.profileImageUrl !== undefined
        ? { profileImageUrl: parsed.data.profileImageUrl }
        : {})
    },
    create: {
      userId: req.user!.userId,
      name: parsed.data.name,
      favoriteMeals: parsed.data.favoriteMeals,
      profileImageUrl: parsed.data.profileImageUrl ?? null
    }
  });

  res.json({
    id: profile.id,
    name: profile.name,
    favoriteMeals: profile.favoriteMeals ?? [],
    profileImageUrl: profile.profileImageUrl ?? null
  });
});

profileRouter.post('/image/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: '画像ファイルがありません (field: file)' });
  }

  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedMimeTypes.includes(req.file.mimetype)) {
    return res.status(400).json({ message: 'サポートされていない画像形式です' });
  }

  const userId = req.user!.userId;
  const existingProfile = await prisma.profile.findUnique({
    where: { userId }
  });

  let imageUrl: string;
  try {
    imageUrl = await uploadProfileImage(userId, req.file);
  } catch (err) {
    console.error('[profile image upload] upload error', err);
    return res.status(500).json({ message: '画像のアップロードに失敗しました' });
  }

  if (existingProfile?.profileImageUrl) {
    deleteProfileImageByUrl(existingProfile.profileImageUrl).catch((err) => {
      console.warn('[profile image upload] failed to delete old image', err);
    });
  }

  const updated = await prisma.profile.upsert({
    where: { userId },
    update: { profileImageUrl: imageUrl },
    create: {
      userId,
      name: existingProfile?.name || '未設定',
      favoriteMeals: existingProfile?.favoriteMeals ?? [],
      profileImageUrl: imageUrl
    }
  });

  res.json({
    id: updated.id,
    name: updated.name,
    favoriteMeals: updated.favoriteMeals ?? [],
    profileImageUrl: updated.profileImageUrl ?? null
  });
});

profileRouter.patch('/image', async (req, res) => {
  const parsed = profileImageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid input', issues: parsed.error.flatten() });
  }

  const profile = await prisma.profile.findUnique({ where: { userId: req.user!.userId } });
  if (!profile) {
    return res.status(404).json({ message: 'Profile not found' });
  }

  const updated = await prisma.profile.update({
    where: { userId: req.user!.userId },
    data: { profileImageUrl: parsed.data.profileImageUrl }
  });

  res.json({
    id: updated.id,
    name: updated.name,
    favoriteMeals: updated.favoriteMeals ?? [],
    profileImageUrl: updated.profileImageUrl ?? null
  });
});
