// backend/src/utils/lineState.ts
import crypto from "node:crypto";
import { SESSION_SECRET } from "../config.js";
function base64UrlEncode(input) {
    return Buffer.from(input).toString("base64url");
}
function base64UrlDecode(input) {
    return Buffer.from(input, "base64url").toString("utf8");
}
function sign(payload, secret) {
    return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}
function timingSafeEquals(a, b) {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length)
        return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
}
function randomHex(bytes = 16) {
    return crypto.randomBytes(bytes).toString("hex");
}
// intent を state に含める
export function generateSignedLineState(intent = "login") {
    const payload = {
        value: randomHex(16),
        nonce: randomHex(16),
        createdAt: Date.now(),
        intent,
    };
    const payloadB64 = base64UrlEncode(JSON.stringify(payload));
    const signature = sign(payloadB64, SESSION_SECRET);
    return {
        token: `${payloadB64}.${signature}`,
        payload,
    };
}
export function verifySignedLineState(token, ttlMs) {
    const parts = token.split(".");
    if (parts.length !== 2) {
        return { valid: false, reason: "invalid_format" };
    }
    const [payloadB64, signature] = parts;
    const expectedSignature = sign(payloadB64, SESSION_SECRET);
    if (!timingSafeEquals(signature, expectedSignature)) {
        return { valid: false, reason: "invalid_signature" };
    }
    let payloadJson;
    try {
        payloadJson = JSON.parse(base64UrlDecode(payloadB64));
    }
    catch {
        return { valid: false, reason: "invalid_payload" };
    }
    const payload = payloadJson;
    if (!payload ||
        typeof payload.value !== "string" ||
        typeof payload.nonce !== "string" ||
        typeof payload.createdAt !== "number") {
        return { valid: false, reason: "invalid_payload_shape" };
    }
    // intent が無い古いトークンは login 扱いにフォールバック
    const intent = payload.intent === "register" ? "register" : "login";
    const normalizedPayload = {
        value: payload.value,
        nonce: payload.nonce,
        createdAt: payload.createdAt,
        intent,
    };
    if (Date.now() - normalizedPayload.createdAt > ttlMs) {
        return { valid: false, reason: "expired" };
    }
    return { valid: true, payload: normalizedPayload };
}
