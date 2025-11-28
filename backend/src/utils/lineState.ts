// backend/src/utils/lineState.ts
import crypto from "node:crypto";
import { SESSION_SECRET } from "../config.js";

export type LineLoginMode = "login" | "register";

export type LineStatePayload = {
  value: string;
  nonce: string;
  createdAt: number;
  mode: LineLoginMode;
};

export type LineStateVerification =
  | { valid: true; payload: LineStatePayload }
  | { valid: false; reason: string };

function base64UrlEncode(input: string) {
  return Buffer.from(input).toString("base64url");
}

function base64UrlDecode(input: string) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(payload: string, secret: string) {
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
}

function timingSafeEquals(a: string, b: string) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function randomHex(bytes = 16) {
  return crypto.randomBytes(bytes).toString("hex");
}

/**
 * mode:
 *  - "login"    : ログインフロー（既存ユーザーのみ許可）
 *  - "register" : 新規登録フロー（未登録ならユーザー作成）
 */
export function generateSignedLineState(mode: LineLoginMode = "login") {
  const payload: LineStatePayload = {
    value: randomHex(16),
    nonce: randomHex(16),
    createdAt: Date.now(),
    mode,
  };

  const payloadJson = JSON.stringify(payload);
  const payloadB64 = base64UrlEncode(payloadJson);
  const signature = sign(payloadB64, SESSION_SECRET);

  return {
    token: `${payloadB64}.${signature}`,
    payload,
  };
}

export function verifySignedLineState(
  token: string,
  ttlMs: number
): LineStateVerification {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false, reason: "invalid_format" };
  }

  const [payloadB64, signature] = parts;
  const expectedSignature = sign(payloadB64, SESSION_SECRET);
  if (!timingSafeEquals(signature, expectedSignature)) {
    return { valid: false, reason: "invalid_signature" };
  }

  let payloadJson: unknown;
  try {
    payloadJson = JSON.parse(base64UrlDecode(payloadB64));
  } catch {
    return { valid: false, reason: "invalid_payload" };
  }

  const raw = payloadJson as any;

  if (
    !raw ||
    typeof raw.value !== "string" ||
    typeof raw.nonce !== "string" ||
    typeof raw.createdAt !== "number"
  ) {
    return { valid: false, reason: "invalid_payload_shape" };
  }

  // mode が入っていない or 想定外の値でも、とりあえず "login" とみなして動くようにする
  const mode: LineLoginMode =
    raw.mode === "register" ? "register" : "login";

  const payload: LineStatePayload = {
    value: raw.value,
    nonce: raw.nonce,
    createdAt: raw.createdAt,
    mode,
  };

  if (Date.now() - payload.createdAt > ttlMs) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, payload };
}
