import { IS_PRODUCTION } from '../config.js';
const AUTH_COOKIE_MAX_AGE = 1000 * 60 * 60 * 24 * 7; // 7 days in milliseconds
export const AUTH_COOKIE_NAME = 'gohan_auth_token';
const baseCookieOptions = {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'lax',
    path: '/',
    maxAge: AUTH_COOKIE_MAX_AGE
};
const clearCookieOptions = {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'lax',
    path: '/'
};
export function setAuthCookie(res, token) {
    res.cookie(AUTH_COOKIE_NAME, token, baseCookieOptions);
}
export function clearAuthCookie(res) {
    res.clearCookie(AUTH_COOKIE_NAME, clearCookieOptions);
}
export function getAuthCookie(req) {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) {
        return undefined;
    }
    const targetPrefix = `${AUTH_COOKIE_NAME}=`;
    const parts = cookieHeader.split(';');
    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) {
            continue;
        }
        if (!trimmed.startsWith(targetPrefix)) {
            continue;
        }
        const value = trimmed.slice(targetPrefix.length);
        return decodeURIComponent(value);
    }
    return undefined;
}
