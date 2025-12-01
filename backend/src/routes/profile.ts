// src/routes/profile.ts
import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { buildProfileResponse } from '../utils/user.js';

const MAX_MULTI_SELECT = 10;

const normalizeMultiSelect = (values: string[] | undefined, maxLength = MAX_MULTI_SELECT) => {
  if (!values) {
    return undefined;
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
    if (normalized.length >= maxLength) {
      break;
    }
  }
  return normalized;
};

const createAreaFields = (values: string[] | undefined) => ({
  mainArea: values?.[0] ?? null,
  subAreas: values ? values.slice(1) : []
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(50),
  favoriteMeals: z.array(z.string().trim().min(1).max(100)).max(3),
  areas: z
    .array(z.string().trim().min(1).max(50))
    .max(MAX_MULTI_SELECT)
    .optional(),
  hobbies: z
    .array(z.string().trim().min(1).max(50))
    .max(MAX_MULTI_SELECT)
    .optional(),
  mainArea: z.string().trim().max(50).optional().nullable(),
  subAreas: z
    .array(z.string().trim().min(1).max(50))
    .max(5)
    .optional(),
  defaultBudget: z
    .enum(['UNDER_1000', 'UNDER_1500', 'UNDER_2000', 'OVER_2000'])
    .optional()
    .nullable(),
  drinkingStyle: z
    .enum(['NO_ALCOHOL', 'SOMETIMES', 'ENJOY_DRINKING'])
    .optional()
    .nullable(),
  ngFoods: z
    .array(z.string().trim().min(1).max(50))
    .max(10)
    .optional(),
  bio: z.string().trim().max(200).optional().nullable(),
  mealStyle: z
    .enum(['TALK_DEEP', 'CASUAL_CHAT', 'BRAINSTORM'])
    .optional()
    .nullable(),
  goMealFrequency: z
    .enum(['WEEKLY', 'BIWEEKLY', 'MONTHLY'])
    .optional()
    .nullable()
});

export const profileRouter = Router();

profileRouter.use(authMiddleware);

// ========= 画像アップロード用の設定 =========

// アップロード先ディレクトリ
const uploadDir = path.resolve('uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// どこに・どんなファイル名で保存するか
const storage = multer.diskStorage({
  destination: (_req: any, _file: any, cb: any) => {
    cb(null, uploadDir);
  },
  filename: (_req: any, file: any, cb: any) => {
    const ext = path.extname(file.originalname || '');
    const base = path.basename(file.originalname || 'image', ext);
    const safeBase = (base || 'image').replace(/[^a-zA-Z0-9_-]/g, '');
    cb(null, `${Date.now()}-${safeBase}${ext}`);
  },
});

// 画像ファイルのみ許可
const fileFilter = (_req: any, file: any, cb: any) => {
  if (!file.mimetype || !file.mimetype.startsWith('image/')) {
    return cb(new Error('画像ファイルのみアップロードできます'));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// ========= プロフィール取得 =========

profileRouter.get('/', async (req, res) => {
  const profile = await prisma.profile.findUnique({
    where: { userId: req.user!.userId }
  });

  if (!profile) {
    return res.status(404).json({ message: 'Profile not found' });
  }

  res.json(buildProfileResponse(profile));
});

// ========= プロフィール更新（名前 & 好きなご飯） =========

profileRouter.put('/', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: 'Invalid input', issues: parsed.error.flatten() });
  }

  const body = req.body as Record<string, unknown>;
  const hasProperty = (key: string) =>
    Object.prototype.hasOwnProperty.call(body, key);

  const normalizedAreas = normalizeMultiSelect(parsed.data.areas);
  const normalizedHobbies = normalizeMultiSelect(parsed.data.hobbies);
  const hasAreas = hasProperty('areas');
  const hasHobbies = hasProperty('hobbies');
  const areaUpdateFields = hasAreas
    ? createAreaFields(normalizedAreas)
    : {
        ...(hasProperty('mainArea') ? { mainArea: parsed.data.mainArea } : {}),
        ...(hasProperty('subAreas')
          ? { subAreas: parsed.data.subAreas ?? [] }
          : {})
      };
  const hobbiesUpdateFields = hasHobbies
    ? { hobbies: normalizedHobbies ?? [] }
    : {};
  const createAreaData = normalizedAreas
    ? createAreaFields(normalizedAreas)
    : {
        mainArea: parsed.data.mainArea ?? null,
        subAreas: parsed.data.subAreas ?? []
      };

  const profile = await prisma.profile.upsert({
    where: { userId: req.user!.userId },
    update: {
      name: parsed.data.name,
      favoriteMeals: parsed.data.favoriteMeals,
      ...areaUpdateFields,
      ...(hasProperty('defaultBudget')
        ? { defaultBudget: parsed.data.defaultBudget }
        : {}),
      ...(hasProperty('drinkingStyle')
        ? { drinkingStyle: parsed.data.drinkingStyle }
        : {}),
      ...(hasProperty('ngFoods') ? { ngFoods: parsed.data.ngFoods ?? [] } : {}),
      ...(hasProperty('bio') ? { bio: parsed.data.bio } : {}),
      ...(hasProperty('mealStyle')
        ? { mealStyle: parsed.data.mealStyle }
        : {}),
      ...(hasProperty('goMealFrequency')
        ? { goMealFrequency: parsed.data.goMealFrequency }
        : {}),
      ...hobbiesUpdateFields
    },
    create: {
      userId: req.user!.userId,
      name: parsed.data.name,
      favoriteMeals: parsed.data.favoriteMeals,
      ...createAreaData,
      defaultBudget: parsed.data.defaultBudget ?? null,
      drinkingStyle: parsed.data.drinkingStyle ?? null,
      ngFoods: parsed.data.ngFoods ?? [],
      bio: parsed.data.bio ?? null,
      mealStyle: parsed.data.mealStyle ?? null,
      goMealFrequency: parsed.data.goMealFrequency ?? null,
      hobbies: normalizedHobbies ?? []
    },
  });

  res.json(buildProfileResponse(profile));
});

// ========= プロフィール画像アップロード =========

profileRouter.post('/image', upload.single('image'), async (req, res) => {
  // ★ ここが今回のエラー箇所：型だけ any にキャスト
  const file = (req as any).file as any;

  if (!file) {
    return res.status(400).json({ message: '画像ファイルが見つかりません' });
  }

  const filePath: string = file.path;
  const filename = path.basename(filePath);
  const imageUrl = `/uploads/${filename}`;

  const profile = await prisma.profile.upsert({
    where: { userId: req.user!.userId },
    update: { profileImageUrl: imageUrl },
    create: {
      userId: req.user!.userId,
      name: '未設定',
      favoriteMeals: [],
      profileImageUrl: imageUrl,
      subAreas: [],
      ngFoods: [],
      hobbies: []
    },
  });

  res.json(buildProfileResponse(profile));
});
