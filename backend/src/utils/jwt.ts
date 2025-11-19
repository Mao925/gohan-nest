import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config.js';

export type JwtPayload = {
  userId: string;
  email: string;
  isAdmin: boolean;
};

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}
