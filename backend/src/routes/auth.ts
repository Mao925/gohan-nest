// backend/src/routes/auth.ts
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../utils/jwt.js';
import { authMiddleware } from '../middleware/auth.js';
import { buildUserPayload } from '../utils/user.js';
import { getApprovedMembership } from '../utils/membership.js';
import {
  ADMIN_INVITE_CODE,
  CLIENT_ORIGIN,
  FRONTEND_URL,
  LINE_LOGIN_CHANNEL_ID,
  LINE_LOGIN_CHANNEL_SECRET,
  LINE_LOGIN_REDIRECT_URI
} from '../config.js';
import { generateSignedLineState, verifySignedLineState } from '../utils/lineState.js';

type LineTokenResponse = {
  access_token: string;
  expires_in: number;
  id_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type: string;
};

type LineProfileResponse = {
  userId: string;
  displayName: string;
  pictureUrl?: string;
  statusMessage?: string;
};

const STATE_TTL_MS = 1000 * 60 * 10;

function generateRandomString(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

function ensureLineEnv() {
  return Boolean(
    LINE_LOGIN_CHANNEL_ID &&
      LINE_LOGIN_CHANNEL_SECRET &&
      LINE_LOGIN_REDIRECT_URI
  );
}

function buildFrontendRedirect(token: string, isNewUser: boolean) {
  const base = FRONTEND_URL || CLIENT_ORIGIN || 'http://localhost:3000';
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    url = new URL(`https://${base}`);
  }
  url.pathname = '/auth/line/callback';
  url.searchParams.set('token', token);
  url.searchParams.set('newUser', String(isNewUser)); // "true" or "false"
  return url.toString();
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1)
});

const adminRegisterSchema = registerSchema.extend({
  adminInviteCode: z.string().min(1)
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

  const user = await prisma.$transaction(async (tx: any) => {
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
        favoriteMeals: []
      }
    });

    return createdUser;
  });

  await getApprovedMembership(user.id);
  const token = signToken({ userId: user.id, email: user.email, isAdmin: user.isAdmin });
  const payload = await buildUserPayload(user.id);
  return res.status(201).json({ token, user: payload });
});

authRouter.post('/register-admin', async (req, res) => {
  try {
    const parsed = adminRegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Invalid input', issues: parsed.error.flatten() });
    }

    if (!ADMIN_INVITE_CODE) {
      return res.status(500).json({ message: 'Admin invite code is not configured' });
    }

    if (parsed.data.adminInviteCode !== ADMIN_INVITE_CODE) {
      return res.status(403).json({ message: 'Invalid admin invite code' });
    }

    const { email, password, name } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.$transaction(async (tx: any) => {
      const createdUser = await tx.user.create({
        data: {
          email,
          passwordHash,
          isAdmin: true
        }
      });

      await tx.profile.create({
        data: {
          userId: createdUser.id,
          name,
          favoriteMeals: []
        }
      });

      return createdUser;
    });

    if (!user) {
      console.error('[line-callback] user not found after upsert');
      return res
        .status(401)
        .json({
          message:
            'ユーザー情報が見つかりませんでした。もう一度ログインし直してください。'
        });
    }

    if (!user) {
      console.error('[line-callback] user not found after lookup');
      return res
        .status(401)
        .json({
          message:
            'ユーザー情報が見つかりませんでした。もう一度ログインし直してください。'
        });
    }

    if (!user) {
      console.error('[auth/line-callback-register] user not found after lookup');
      return res
        .status(401)
        .json({
          message:
            'ユーザー情報が見つかりませんでした。もう一度ログインし直してください。'
        });
    }

    await getApprovedMembership(user.id);
    const token = signToken({
      userId: user.id,
      email: user.email,
      isAdmin: user.isAdmin
    });
    const payload = await buildUserPayload(user.id);
    return res.status(201).json({ token, user: payload });
  } catch (error: any) {
    console.error('REGISTER ADMIN ERROR:', error);
    const message = error instanceof Error ? error.message : 'Unknown server error';
    return res.status(500).json({ message });
  }
});

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid input', issues: parsed.error.flatten() });
  }

  const { email, password } = parsed.data;
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    console.log('[login] user lookup', { email, userFound: Boolean(user) });

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    console.log('[login] password comparison', { email, passwordMatch });

    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    await getApprovedMembership(user!.id);
    const token = signToken({
      userId: user!.id,
      email: user!.email,
      isAdmin: user!.isAdmin
    });
    const payload = await buildUserPayload(user.id);
    return res.json({ token, user: payload });
  } catch (error: any) {
    console.error('[login] unexpected error', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

/**
 * LINE ログイン（既存ユーザーのみ）
 */
authRouter.get('/line/login', (req, res) => {
  if (!ensureLineEnv()) {
    return res.status(500).json({ message: 'LINE login is not configured' });
  }

  const { token: stateToken, payload: statePayload } = generateSignedLineState('login');

  console.log('LINE login: generated signed state (login)', {
    payload: statePayload,
    ua: req.headers['user-agent'],
    cookie: req.headers.cookie,
  });

  const searchParams = new URLSearchParams({
    response_type: 'code',
    client_id: LINE_LOGIN_CHANNEL_ID!,
    redirect_uri: LINE_LOGIN_REDIRECT_URI!,
    state: stateToken,
    scope: 'openid profile',
    nonce: statePayload.nonce,
    bot_prompt: 'aggressive', // or 'aggressive'
  });

  const authorizationUrl = `https://access.line.me/oauth2/v2.1/authorize?${searchParams.toString()}`;
  console.log('[line-login] redirectUri', LINE_LOGIN_REDIRECT_URI);
  console.log('[line-login] authorizationUrl', authorizationUrl);
  res.setHeader('Cache-Control', 'no-store');
  return res.redirect(authorizationUrl);
});

/**
 * LINE 新規登録（未登録ユーザーのみ作成を許可）
 */
authRouter.get('/line/register', (req, res) => {
  if (!ensureLineEnv()) {
    return res.status(500).json({ message: 'LINE login is not configured' });
  }

  const { token: stateToken, payload: statePayload } = generateSignedLineState('register');

  console.log('LINE login: generated signed state (register)', {
    payload: statePayload,
    ua: req.headers['user-agent'],
    cookie: req.headers.cookie,
  });

  const searchParams = new URLSearchParams({
    response_type: 'code',
    client_id: LINE_LOGIN_CHANNEL_ID!,
    redirect_uri: LINE_LOGIN_REDIRECT_URI!,
    state: stateToken,
    scope: 'openid profile',
    nonce: statePayload.nonce,
    bot_prompt: 'aggressive', // or 'aggressive'
  });

  const authorizationUrl = `https://access.line.me/oauth2/v2.1/authorize?${searchParams.toString()}`;
  console.log('[line-login-register] redirectUri', LINE_LOGIN_REDIRECT_URI);
  console.log('[line-login-register] authorizationUrl', authorizationUrl);
  res.setHeader('Cache-Control', 'no-store');
  return res.redirect(authorizationUrl);
});

authRouter.get('/line/callback', async (req, res) => {
  if (!ensureLineEnv()) {
    return res.status(500).json({ message: 'LINE login is not configured' });
  }

  const code = typeof req.query.code === 'string' ? req.query.code : null;
  const state = typeof req.query.state === 'string' ? req.query.state : null;

  console.log('LINE callback: query', { code, state });

  if (!code || !state) {
    return res.status(400).json({ message: 'Missing code or state' });
  }

  const verification = verifySignedLineState(state, STATE_TTL_MS);

  console.log('LINE callback: state verification', {
    result: verification.valid ? 'valid' : verification.reason,
    payload: verification.valid ? verification.payload : undefined,
    ua: req.headers['user-agent'],
    cookie: req.headers.cookie,
  });

  if (!verification.valid) {
    return res.status(400).json({ message: 'Invalid or expired state' });
  }

  const intent = verification.payload.intent; // "login" | "register"

  try {
    const tokenResponse = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: LINE_LOGIN_REDIRECT_URI!,
        client_id: LINE_LOGIN_CHANNEL_ID!,
        client_secret: LINE_LOGIN_CHANNEL_SECRET!,
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('LINE token exchange failed:', tokenResponse.status, errorText);
      return res.status(502).json({ message: 'Failed to exchange LINE authorization code' });
    }

    const tokenJson = await tokenResponse.json() as LineTokenResponse;

    const profileResponse = await fetch('https://api.line.me/v2/profile', {
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`
      }
    });

    if (!profileResponse.ok) {
      const errorText = await profileResponse.text();
      console.error('LINE profile fetch failed:', profileResponse.status, errorText);
      return res.status(502).json({ message: 'Failed to fetch LINE profile' });
    }

    const profileJson = await profileResponse.json() as LineProfileResponse;
    if (!profileJson.userId) {
      return res.status(502).json({ message: 'LINE profile did not include userId' });
    }

    let user = await prisma.user.findUnique({
      where: { lineUserId: profileJson.userId }
    });

    const placeholderEmail = `line_${profileJson.userId}@line.local`;
    let isNewUser = false;

    // login intent で user が存在しない場合 → 新規作成せずエラーでフロントに返す
    if (!user && intent === 'login') {
      console.log('[LINE CALLBACK] login intent but no user found, redirecting with error');
      const base = FRONTEND_URL || CLIENT_ORIGIN || 'http://localhost:3000';
      let url: URL;
      try {
        url = new URL(base);
      } catch {
        url = new URL(`https://${base}`);
      }
      url.pathname = '/auth/line/callback';
      url.searchParams.set('error', 'not_registered');
      return res.redirect(url.toString());
    }

    // 上記以外:
    // - intent === 'register' で user がまだ無い → 新規作成 (isNewUser=true)
    // - intent === 'register' で user 既にあり → 更新 (isNewUser=false)
    // - intent === 'login' で user 既にあり → 更新 (isNewUser=false)
    if (!user) {
      const hashedPassword = await bcrypt.hash(generateRandomString(24), 10);
      isNewUser = true;
      user = await prisma.$transaction(async (tx: any) => {
        const createdUser = await tx.user.create({
          data: {
            email: placeholderEmail,
            passwordHash: hashedPassword,
            isAdmin: false,
            lineUserId: profileJson.userId,
            lineDisplayName: profileJson.displayName,
            linePictureUrl: profileJson.pictureUrl ?? null
          }
        });

        await tx.profile.create({
          data: {
            userId: createdUser.id,
            name: profileJson.displayName || 'LINE User',
            favoriteMeals: []
          }
        });

        return createdUser;
      });
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          lineDisplayName: profileJson.displayName,
          linePictureUrl: profileJson.pictureUrl ?? null
        }
      });
    }

    if (!user) {
      console.error('LINE callback: user is null after find/create');
      return res.status(500).json({ error: 'Failed to create or fetch user' });
    }

    await getApprovedMembership(user!.id);
    const token = signToken({
      userId: user!.id,
      email: user!.email,
      isAdmin: user!.isAdmin
    });

    const redirectUrl = buildFrontendRedirect(token, isNewUser);
    return res.redirect(redirectUrl);
  } catch (error: any) {
    console.error('LINE callback error:', error);
    return res.status(500).json({ message: 'Failed to complete LINE login' });
  }
});

authRouter.get('/me', authMiddleware, async (req, res) => {
  try {
    const payload = await buildUserPayload(req.user!.userId);
    return res.json(payload);
  } catch (error: any) {
    return res.status(404).json({ message: 'User not found' });
  }
});
