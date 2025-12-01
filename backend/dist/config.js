import dotenv from "dotenv";
import path from "node:path";
const isRailway = Boolean(process.env.RAILWAY_ENVIRONMENT) ||
    Boolean(process.env.RAILWAY_ENVIRONMENT_NAME) ||
    Boolean(process.env.RAILWAY_PROJECT_ID) ||
    Boolean(process.env.RAILWAY_PUBLIC_DOMAIN);
const runtimeEnv = process.env.NODE_ENV || (isRailway ? "production" : "development");
const envFileName = runtimeEnv === "production"
    ? ".env.production"
    : runtimeEnv === "test"
        ? ".env.test"
        : ".env";
const configResult = dotenv.config({
    path: path.resolve(process.cwd(), envFileName),
});
if (configResult.error && envFileName !== ".env") {
    dotenv.config();
}
const isProduction = runtimeEnv === "production";
const rawSessionSecret = process.env.SESSION_SECRET?.trim();
const sessionSecret = rawSessionSecret || (isProduction ? undefined : "dev-session-secret");
if (isProduction && !sessionSecret) {
    throw new Error("SESSION_SECRET must be set in production to issue secure session cookies.");
}
if (!isProduction && !rawSessionSecret) {
    console.warn("SESSION_SECRET is not set. Using insecure default for development only.");
}
export const NODE_ENV = runtimeEnv;
export const IS_PRODUCTION = isProduction;
export const PORT = Number(process.env.PORT || 3001);
export const JWT_SECRET = process.env.JWT_SECRET || "super-secret";
export const DEFAULT_COMMUNITY_NAME = process.env.DEFAULT_COMMUNITY_NAME || "KING";
export const DEFAULT_COMMUNITY_CODE = process.env.DEFAULT_COMMUNITY_CODE || "KINGCODE";
export const DATABASE_URL = process.env.DATABASE_URL;
export const CLIENT_ORIGIN = process.env.NEXT_PUBLIC_API_BASE_URL;
export const FRONTEND_URL = process.env.FRONTEND_URL || CLIENT_ORIGIN;
export const LINE_LOGIN_CHANNEL_ID = process.env.LINE_LOGIN_CHANNEL_ID;
export const LINE_LOGIN_CHANNEL_SECRET = process.env.LINE_LOGIN_CHANNEL_SECRET;
export const LINE_LOGIN_REDIRECT_URI = process.env.LINE_LOGIN_REDIRECT_URI;
export const LINE_MESSAGING_CHANNEL_SECRET = process.env.LINE_MESSAGING_CHANNEL_SECRET;
export const LINE_MESSAGING_CHANNEL_ACCESS_TOKEN = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
export const ENABLE_LINE_DAILY_AVAILABILITY_PUSH = process.env.ENABLE_LINE_DAILY_AVAILABILITY_PUSH !== "false";
export const AUTO_APPROVE_MEMBERS = process.env.AUTO_APPROVE_MEMBERS === "true";
export const SEED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || "admin@example.com";
export const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "changeme";
export const ENABLE_SEED_ADMIN = process.env.ENABLE_SEED_ADMIN === "true";
const useSeedEnv = process.env.USE_SEED_MEMBERS ?? process.env.USE_SEED;
export const INCLUDE_SEED_USERS = (useSeedEnv ?? "true") !== "false";
export const ADMIN_INVITE_CODE = process.env.ADMIN_INVITE_CODE;
export const ENABLE_RESET_LIKE_ENDPOINT = process.env.ENABLE_RESET_LIKE_ENDPOINT === "true";
export const DEV_RESET_LIKE_ENDPOINT = process.env.DEV_RESET_LIKE_ENDPOINT ||
    process.env.NEXT_PUBLIC_DEV_RESET_LIKE_ENDPOINT;
export const SESSION_SECRET = sessionSecret;
const missingLineEnv = [
    { key: "LINE_LOGIN_CHANNEL_ID", value: LINE_LOGIN_CHANNEL_ID },
    { key: "LINE_LOGIN_CHANNEL_SECRET", value: LINE_LOGIN_CHANNEL_SECRET },
    { key: "LINE_LOGIN_REDIRECT_URI", value: LINE_LOGIN_REDIRECT_URI },
    { key: "LINE_MESSAGING_CHANNEL_SECRET", value: LINE_MESSAGING_CHANNEL_SECRET },
    { key: "LINE_MESSAGING_CHANNEL_ACCESS_TOKEN", value: LINE_MESSAGING_CHANNEL_ACCESS_TOKEN },
]
    .filter((item) => !item.value);
if (!DATABASE_URL) {
    console.warn("DATABASE_URL is not set. Prisma will fail to connect.");
}
if (missingLineEnv.length > 0) {
    console.error(`LINE environment variables are missing: ${missingLineEnv
        .map((item) => item.key)
        .join(", ")}`);
}
