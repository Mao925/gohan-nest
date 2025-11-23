import { verifyToken } from '../utils/jwt.js';
export function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header) {
        return res.status(401).json({ message: 'Missing Authorization header' });
    }
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ message: 'Invalid Authorization header' });
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
