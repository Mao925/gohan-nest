import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import session from "express-session";
import {
  PORT,
  DEFAULT_COMMUNITY_CODE,
  DEFAULT_COMMUNITY_NAME,
  CLIENT_ORIGIN,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  ENABLE_SEED_ADMIN,
  ENABLE_RESET_LIKE_ENDPOINT,
  DEV_RESET_LIKE_ENDPOINT,
  SESSION_SECRET,
} from "./config.js";
import { prisma } from "./lib/prisma.js";
import { authRouter } from "./routes/auth.js";
import { communityRouter } from "./routes/community.js";
import { adminRouter } from "./routes/admin.js";
import { profileRouter } from "./routes/profile.js";
import { membersRouter } from "./routes/members.js";
import { likesRouter } from "./routes/likes.js";
import { matchesRouter } from "./routes/matches.js";
import devRouter from "./routes/dev.js";
import { availabilityRouter } from "./routes/availability.js";

const NODE_ENV = process.env.NODE_ENV || "development";
console.log(`Starting API server in ${NODE_ENV} mode`);

const app = express();
app.set("trust proxy", 1);

if (NODE_ENV === "production" && !SESSION_SECRET) {
  throw new Error(
    "SESSION_SECRET must be set in production to issue secure session cookies."
  );
}

function uniqueOrigins(origins: Array<string | undefined>) {
  return Array.from(
    new Set(
      origins.filter((origin): origin is string => Boolean(origin))
    )
  );
}

function getOriginFromUrl(url?: string) {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

const allowedOrigins = uniqueOrigins([
  "https://gohan-expo.vercel.app", // production client
  "http://localhost:3000", // local dev client
  CLIENT_ORIGIN,
  getOriginFromUrl(DEV_RESET_LIKE_ENDPOINT),
]);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// OPTIONS を確実に許可
app.options("*", cors());

app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET || "dev-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: NODE_ENV === "production",
      sameSite: "lax",
    },
  })
);

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api/community", communityRouter);
app.use("/api/admin", adminRouter);
app.use("/api/profile", profileRouter);
app.use("/api/members", membersRouter);
app.use("/api/like", likesRouter);
app.use("/api/matches", matchesRouter);
app.use("/api/availability", availabilityRouter);
app.use("/api/dev", devRouter);

async function ensureDefaultCommunity() {
  await prisma.community.upsert({
    where: { inviteCode: DEFAULT_COMMUNITY_CODE },
    update: { name: DEFAULT_COMMUNITY_NAME },
    create: {
      name: DEFAULT_COMMUNITY_NAME,
      inviteCode: DEFAULT_COMMUNITY_CODE,
    },
  });
}

async function ensureDefaultAdmin() {
  if (!SEED_ADMIN_EMAIL || !SEED_ADMIN_PASSWORD) {
    return;
  }

  const community = await prisma.community.findUnique({
    where: { inviteCode: DEFAULT_COMMUNITY_CODE },
  });
  if (!community) return;

  let admin = await prisma.user.findUnique({
    where: { email: SEED_ADMIN_EMAIL },
  });
  if (!admin) {
    admin = await prisma.user.create({
      data: {
        email: SEED_ADMIN_EMAIL,
        passwordHash: await bcrypt.hash(SEED_ADMIN_PASSWORD, 10),
        isAdmin: true,
      },
    });
    await prisma.profile.create({
      data: {
        userId: admin.id,
        name: "Admin User",
        bio: "Auto seeded admin",
      },
    });
  }

  await prisma.communityMembership.upsert({
    where: {
      userId_communityId: { userId: admin.id, communityId: community.id },
    },
    update: { status: "approved" },
    create: {
      userId: admin.id,
      communityId: community.id,
      status: "approved",
    },
  });
}

async function bootstrap() {
  await ensureDefaultCommunity();
  if (ENABLE_SEED_ADMIN) {
    await ensureDefaultAdmin();
  }

  app.listen(PORT, () => {
    console.log(`API server running on port ${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error("Failed to start server", err);
  process.exit(1);
});
