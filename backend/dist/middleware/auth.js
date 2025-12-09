import { verifyToken } from '../utils/jwt.js';
import { getAuthCookie } from '../utils/authCookies.js';
export function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    let token;
    if (header) {
        const [scheme, ...rest] = header.split(' ');
        if (scheme?.toLowerCase() === 'bearer' && rest.length > 0) {
            token = rest.join(' ');
        }
    }
    if (!token) {
        token = getAuthCookie(req);
    }
    if (!token) {
        return res.status(401).json({ message: 'Authorization token missing' });
    }
    try {
        const payload = verifyToken(token);
        req.user = payload;
        next();
    }
    catch (err) {
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
}
export function adminOnly(req, res, next) {
    if (!req.user?.isAdmin) {
        return res.status(403).json({ message: 'Admin access required' });
    }
    next();
}
