import dotenv from 'dotenv';

dotenv.config();

export const PORT = Number(process.env.PORT || 3001);
export const JWT_SECRET = process.env.JWT_SECRET || 'super-secret';
export const DEFAULT_COMMUNITY_NAME = process.env.DEFAULT_COMMUNITY_NAME || 'KING';
export const DEFAULT_COMMUNITY_CODE = process.env.DEFAULT_COMMUNITY_CODE || 'KINGCODE';
export const DATABASE_URL = process.env.DATABASE_URL;
export const CLIENT_ORIGIN = process.env.NEXT_PUBLIC_API_BASE_URL;
export const AUTO_APPROVE_MEMBERS = process.env.AUTO_APPROVE_MEMBERS === 'true';
export const SEED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
export const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';
const useSeedEnv = process.env.USE_SEED_MEMBERS ?? process.env.USE_SEED;
export const INCLUDE_SEED_USERS = (useSeedEnv ?? 'true') !== 'false';

if (!DATABASE_URL) {
  console.warn('DATABASE_URL is not set. Prisma will fail to connect.');
}
