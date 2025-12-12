import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import { ensureSameCommunity, getApprovedMembership, } from "../utils/membership.js";
import { createOrFindMatchIfReciprocalYes } from "../services/matchService.js";
const superLikeCreateSchema = z.object({
    targetUserId: z.string().uuid(),
});
const targetIdParamSchema = z.string().uuid();
const JOIN_REQUIRED_RESPONSE = {
    message: "コミュニティ参加後にご利用ください。先に参加コードで /api/community/join を呼び出してください。",
    status: "UNAPPLIED",
    action: "JOIN_REQUIRED",
};
export const superLikesRouter = Router();
superLikesRouter.use(authMiddleware);
superLikesRouter.get("/", async (req, res) => {
    const membership = await getApprovedMembership(req.user.userId);
    if (!membership) {
        return res.status(400).json(JOIN_REQUIRED_RESPONSE);
    }
    try {
        const superLikes = await prisma.superLike.findMany({
            where: {
                fromUserId: req.user.userId,
                communityId: membership.communityId,
            },
            select: {
                toUserId: true,
                createdAt: true,
            },
        });
        return res.json({ superLikes });
    }
    catch (err) {
        console.error("GET SUPER LIKES ERROR", err);
        return res.status(500).json({ message: "Internal server error" });
    }
});
superLikesRouter.post("/", async (req, res) => {
    const membership = await getApprovedMembership(req.user.userId);
    if (!membership) {
        return res.status(400).json(JOIN_REQUIRED_RESPONSE);
    }
    const parsed = superLikeCreateSchema.safeParse(req.body);
    if (!parsed.success) {
        return res
            .status(400)
            .json({ message: "Invalid input", issues: parsed.error.flatten() });
    }
    try {
        await ensureSameCommunity(req.user.userId, parsed.data.targetUserId, membership.communityId);
    }
    catch (error) {
        return res.status(400).json({ message: error.message });
    }
    try {
        const result = await prisma.$transaction(async (tx) => {
            const currentUserId = req.user.userId;
            const targetUserId = parsed.data.targetUserId;
            const communityId = membership.communityId;
            const existingSuperLike = await tx.superLike.findFirst({
                where: {
                    fromUserId: currentUserId,
                    communityId,
                },
                orderBy: { createdAt: "desc" },
            });
            if (existingSuperLike && existingSuperLike.toUserId === targetUserId) {
                // 同一のユーザーに対する連続リクエストは冪等に扱う
            }
            else {
                if (existingSuperLike) {
                    // 1人1つだけなので別の対象がある場合は削除して切り替える
                    await tx.superLike.delete({ where: { id: existingSuperLike.id } });
                }
                await tx.superLike.create({
                    data: {
                        fromUserId: currentUserId,
                        toUserId: targetUserId,
                        communityId,
                    },
                });
            }
            await tx.like.upsert({
                where: {
                    fromUserId_toUserId_communityId: {
                        fromUserId: currentUserId,
                        toUserId: targetUserId,
                        communityId,
                    },
                },
                update: { answer: "YES" },
                create: {
                    fromUserId: currentUserId,
                    toUserId: targetUserId,
                    communityId,
                    answer: "YES",
                },
            });
            const matchRecord = await createOrFindMatchIfReciprocalYes({
                tx,
                communityId,
                fromUserId: currentUserId,
                toUserId: targetUserId,
            });
            if (!matchRecord) {
                return { matched: false };
            }
            const targetProfile = await tx.profile.findUnique({
                where: { userId: targetUserId },
            });
            return {
                matched: true,
                matchedAt: matchRecord.createdAt.toISOString(),
                partnerName: targetProfile?.name || "",
                partnerFavoriteMeals: targetProfile?.favoriteMeals || [],
            };
        });
        if (result.matched) {
            return res.json({
                matched: true,
                matchedAt: result.matchedAt,
                partnerName: result.partnerName,
                partnerFavoriteMeals: result.partnerFavoriteMeals,
            });
        }
        return res.json({ matched: false });
    }
    catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002") {
            return res
                .status(409)
                .json({ message: "このユーザーには既にスターを送っています" });
        }
        console.error("CREATE SUPER LIKE ERROR", error);
        return res.status(500).json({ message: "Internal server error" });
    }
});
superLikesRouter.delete("/:targetUserId", async (req, res) => {
    const parsed = targetIdParamSchema.safeParse(req.params.targetUserId);
    if (!parsed.success) {
        return res.status(400).json({ message: "Invalid target user id" });
    }
    const membership = await getApprovedMembership(req.user.userId);
    if (!membership) {
        return res.status(400).json(JOIN_REQUIRED_RESPONSE);
    }
    try {
        await ensureSameCommunity(req.user.userId, parsed.data, membership.communityId);
    }
    catch (error) {
        return res.status(400).json({ message: error.message });
    }
    try {
        await prisma.superLike.deleteMany({
            where: {
                fromUserId: req.user.userId,
                toUserId: parsed.data,
                communityId: membership.communityId,
            },
        });
        return res.status(204).send();
    }
    catch (error) {
        console.error("DELETE SUPER LIKE ERROR", error);
        return res.status(500).json({ message: "Internal server error" });
    }
});
