// backend/src/utils/lineState.ts
import crypto from "node:crypto";
import { SESSION_SECRET } from "../config.js";

export type LineStateFlow = "login" | "register";

export type LineStatePayload = {
  value: string;
  nonce: string;
  createdAt: number;
  flow: LineStateFlow;
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
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
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

// flow を state に含める
export function generateSignedLineState(flow: LineStateFlow = "login") {
  const payload: LineStatePayload = {
    value: randomHex(16),
    nonce: randomHex(16),
    createdAt: Date.now(),
    flow,
  };

  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
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

  const payload = payloadJson as Partial<LineStatePayload> & {
    intent?: LineStateFlow;
  };
  if (
    !payload ||
    typeof payload.value !== "string" ||
    typeof payload.nonce !== "string" ||
    typeof payload.createdAt !== "number"
  ) {
    return { valid: false, reason: "invalid_payload_shape" };
  }

  // intent が無い古いトークンは login 扱いにフォールバック
  const flow: LineStateFlow =
    payload.flow === "register"
      ? "register"
      : payload.intent === "register"
      ? "register"
      : "login";

  const normalizedPayload: LineStatePayload = {
    value: payload.value,
    nonce: payload.nonce,
    createdAt: payload.createdAt,
    flow,
  };

  if (Date.now() - normalizedPayload.createdAt > ttlMs) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, payload: normalizedPayload };
}
