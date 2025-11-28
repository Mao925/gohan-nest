// src/routes/profile.ts
import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
const updateSchema = z.object({
    name: z.string().min(1),
    favoriteMeals: z.array(z.string().trim().min(1).max(100)).max(3),
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
    destination: (_req, _file, cb) => {
        cb(null, uploadDir);
    },
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname || '');
        const base = path.basename(file.originalname || 'image', ext);
        const safeBase = (base || 'image').replace(/[^a-zA-Z0-9_-]/g, '');
        cb(null, `${Date.now()}-${safeBase}${ext}`);
    },
});
// 画像ファイルのみ許可
const fileFilter = (_req, file, cb) => {
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
        where: { userId: req.user.userId },
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
// ========= プロフィール更新（名前 & 好きなご飯） =========
profileRouter.put('/', async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
        return res
            .status(400)
            .json({ message: 'Invalid input', issues: parsed.error.flatten() });
    }
    const profile = await prisma.profile.upsert({
        where: { userId: req.user.userId },
        update: {
            name: parsed.data.name,
            favoriteMeals: parsed.data.favoriteMeals,
        },
        create: {
            userId: req.user.userId,
            name: parsed.data.name,
            favoriteMeals: parsed.data.favoriteMeals,
        },
    });
    res.json({
        id: profile.id,
        name: profile.name,
        favoriteMeals: profile.favoriteMeals ?? [],
        profileImageUrl: profile.profileImageUrl ?? null,
    });
});
// ========= プロフィール画像アップロード =========
profileRouter.post('/image', upload.single('image'), async (req, res) => {
    // ★ ここが今回のエラー箇所：型だけ any にキャスト
    const file = req.file;
    if (!file) {
        return res.status(400).json({ message: '画像ファイルが見つかりません' });
    }
    const filePath = file.path;
    const filename = path.basename(filePath);
    const imageUrl = `/uploads/${filename}`;
    const profile = await prisma.profile.upsert({
        where: { userId: req.user.userId },
        update: { profileImageUrl: imageUrl },
        create: {
            userId: req.user.userId,
            name: '未設定',
            favoriteMeals: [],
            profileImageUrl: imageUrl,
        },
    });
    res.json({
        id: profile.id,
        name: profile.name,
        favoriteMeals: profile.favoriteMeals ?? [],
        profileImageUrl: profile.profileImageUrl ?? null,
    });
});
