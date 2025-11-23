import "express-session";
import type { JwtPayload } from '../utils/jwt.js';

declare module "express-session" {
  interface SessionData {
    lineState?: {
      value: string;
      nonce: string;
      createdAt: number;
    };
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}
