// backend/src/routes/profile.ts
import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

const updateSchema = z.object({
  name: z.string().min(1),
  favoriteMeals: z.array(z.string().trim().min(1).max(100)).max(3)
});

export const profileRouter = Router();

// ------- 画像アップロード用の設定 -------

// 保存先ディレクトリを作成
const UPLOAD_ROOT = path.resolve('uploads/profile');
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_ROOT),
    filename: (req: any, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      const userId = req.user?.userId ?? 'anonymous';
      const filename = `${userId}-${Date.now()}${ext}`;
      cb(null, filename);
    }
  }),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('画像ファイルのみアップロードできます'));
    } else {
      cb(null, true);
    }
  }
});

// リクエストから「このバックエンドのオリジン」を作って画像URLを返す
function buildProfileImageUrl(req: any, filename: string) {
  const proto =
    (req.headers['x-forwarded-proto'] as string | undefined) || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const origin = `${proto}://${host}`;
  return `${origin}/uploads/profile/${filename}`;
}

// ------- 認証必須 -------

profileRouter.use(authMiddleware);

// GET /api/profile
profileRouter.get('/', async (req, res) => {
  const profile = await prisma.profile.findUnique({
    where: { userId: req.user!.userId }
  });

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

// PUT /api/profile
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
    favoriteMeals: profile.favoriteMeals ?? [],
    profileImageUrl: profile.profileImageUrl ?? null
  });
});

// POST /api/profile/image
profileRouter.post(
  '/image',
  upload.single('image'),
  async (req: any, res) => {
    try {
      const file = req.file as Express.Multer.File | undefined;
      if (!file) {
        return res.status(400).json({ message: '画像ファイルが選択されていません' });
      }

      const imageUrl = buildProfileImageUrl(req, file.filename);

      // プロフィールに URL を保存
      const profile = await prisma.profile.upsert({
        where: { userId: req.user!.userId },
        update: { profileImageUrl: imageUrl },
        create: {
          userId: req.user!.userId,
          name: '未設定',
          favoriteMeals: [],
          profileImageUrl: imageUrl
        }
      });

      return res.json({
        id: profile.id,
        name: profile.name,
        favoriteMeals: profile.favoriteMeals ?? [],
        profileImageUrl: profile.profileImageUrl ?? null
      });
    } catch (error) {
      console.error('PROFILE IMAGE UPLOAD ERROR', error);
      return res.status(500).json({ message: '画像のアップロードに失敗しました' });
    }
  }
);
