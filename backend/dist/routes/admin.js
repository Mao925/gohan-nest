import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { adminOnly, authMiddleware } from "../middleware/auth.js";
import { signToken } from "../utils/jwt.js";
import { buildUserPayload } from "../utils/user.js";
import { getApprovedMembership } from "../utils/membership.js";
import { SEED_ADMIN_EMAIL } from "../config.js";
export const adminRouter = Router();
const adminLoginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
});
adminRouter.post("/login", async (req, res) => {
    const parsed = adminLoginSchema.safeParse(req.body);
    if (!parsed.success) {
        return res
            .status(400)
            .json({ message: "Invalid input", issues: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isAdmin) {
        return res.status(401).json({ message: "Invalid admin credentials" });
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
        return res.status(401).json({ message: "Invalid admin credentials" });
    }
    await getApprovedMembership(user.id);
    const token = signToken({
        userId: user.id,
        email: user.email,
        isAdmin: true,
    });
    const payload = await buildUserPayload(user.id);
    return res.json({ token, user: payload });
});
adminRouter.use(authMiddleware, adminOnly);
adminRouter.get("/join-requests", async (_req, res) => {
    const requests = await prisma.communityMembership.findMany({
        where: { status: "pending" },
        include: { user: { include: { profile: true } }, community: true },
        orderBy: { createdAt: "asc" },
    });
    res.json(requests.map((request) => ({
        id: request.id,
        name: request.user.profile?.name || "",
        email: request.user.email,
        requestedAt: request.createdAt.toISOString(),
    })));
});
adminRouter.post("/join-requests/:id/approve", async (req, res) => {
    const membership = await prisma.communityMembership.update({
        where: { id: req.params.id },
        data: { status: "approved" },
    });
    res.json({ id: membership.id, status: "APPROVED" });
});
adminRouter.post("/join-requests/:id/reject", async (req, res) => {
    const membership = await prisma.communityMembership.update({
        where: { id: req.params.id },
        data: { status: "rejected" },
    });
    res.json({ id: membership.id, status: "REJECTED" });
});
const promoteSchema = z.object({
    userId: z.string().uuid(),
});
adminRouter.post("/promote", async (req, res) => {
    const parsed = promoteSchema.safeParse(req.body);
    if (!parsed.success) {
        return res
            .status(400)
            .json({ message: "Invalid input", issues: parsed.error.flatten() });
    }
    try {
        const user = await prisma.user.update({
            where: { id: parsed.data.userId },
            data: { isAdmin: true },
        });
        return res.json({ id: user.id, isAdmin: user.isAdmin });
    }
    catch (error) {
        return res.status(404).json({ message: "User not found" });
    }
});
const removeMemberSchema = z.object({
    userId: z.string().uuid(),
});
adminRouter.post("/remove-member", async (req, res) => {
    const parsed = removeMemberSchema.safeParse(req.body);
    if (!parsed.success) {
        return res
            .status(400)
            .json({ message: "Invalid input", issues: parsed.error.flatten() });
    }
    const user = await prisma.user.findUnique({
        where: { id: parsed.data.userId },
    });
    if (!user) {
        return res.status(404).json({ message: "User not found" });
    }
    await prisma.$transaction(async (tx) => {
        await tx.communityMembership.deleteMany({ where: { userId: user.id } });
        await tx.match.deleteMany({
            where: { OR: [{ user1Id: user.id }, { user2Id: user.id }] },
        });
        await tx.like.deleteMany({
            where: { OR: [{ fromUserId: user.id }, { toUserId: user.id }] },
        });
    });
    return res.json({ removed: true });
});
adminRouter.delete("/members/:memberId", async (req, res) => {
    const userId = req.user?.userId;
    if (!userId) {
        return res.status(401).json({ message: "Authentication required" });
    }
    const myMembership = await getApprovedMembership(userId);
    if (!myMembership) {
        return res
            .status(403)
            .json({ message: "所属コミュニティの管理者メンバーが見つかりません" });
    }
    const targetMembership = await prisma.communityMembership.findFirst({
        where: {
            id: req.params.memberId,
            communityId: myMembership.communityId,
        },
    });
    if (!targetMembership) {
        return res
            .status(404)
            .json({ message: "対象メンバーが見つかりません" });
    }
    if (targetMembership.userId === userId) {
        return res
            .status(400)
            .json({ message: "自分自身のメンバーシップは削除できません" });
    }
    await prisma.communityMembership.delete({
        where: { id: targetMembership.id },
    });
    return res.status(204).send();
});
adminRouter.delete("/seed-admin", async (_req, res) => {
    if (!SEED_ADMIN_EMAIL) {
        return res
            .status(400)
            .json({ message: "SEED_ADMIN_EMAIL is not configured" });
    }
    const user = await prisma.user.findUnique({
        where: { email: SEED_ADMIN_EMAIL },
    });
    if (!user) {
        return res.status(404).json({ message: "Seed admin not found" });
    }
    await prisma.$transaction(async (tx) => {
        await tx.communityMembership.deleteMany({ where: { userId: user.id } });
        await tx.profile.deleteMany({ where: { userId: user.id } });
        await tx.match.deleteMany({
            where: { OR: [{ user1Id: user.id }, { user2Id: user.id }] },
        });
        await tx.like.deleteMany({
            where: { OR: [{ fromUserId: user.id }, { toUserId: user.id }] },
        });
        await tx.user.delete({ where: { id: user.id } });
    });
    return res.json({ deleted: true });
});
