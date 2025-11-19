import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../utils/jwt.js';
import { authMiddleware } from '../middleware/auth.js';
import { buildUserPayload } from '../utils/user.js';
import { getApprovedMembership } from '../utils/membership.js';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid input', issues: parsed.error.flatten() });
  }

  const { email, password, name } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ message: 'Email already registered' });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        email,
        passwordHash,
        isAdmin: false
      }
    });

    await tx.profile.create({
      data: {
        userId: createdUser.id,
        name,
        bio: ''
      }
    });

    return createdUser;
  });

  await getApprovedMembership(user.id);
  const token = signToken({ userId: user.id, email: user.email, isAdmin: user.isAdmin });
  const payload = await buildUserPayload(user.id);
  return res.status(201).json({ token, user: payload });
});

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid input', issues: parsed.error.flatten() });
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  await getApprovedMembership(user.id);
  const token = signToken({ userId: user.id, email: user.email, isAdmin: user.isAdmin });
  const payload = await buildUserPayload(user.id);
  return res.json({ token, user: payload });
});

authRouter.get('/me', authMiddleware, async (req, res) => {
  try {
    const payload = await buildUserPayload(req.user!.userId);
    return res.json(payload);
  } catch (error) {
    return res.status(404).json({ message: 'User not found' });
  }
});
