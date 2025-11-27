import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import { ensureSameCommunity, getApprovedMembership, } from "../utils/membership.js";
import { INCLUDE_SEED_USERS } from "../config.js";
import { buildRelationshipPayload, formatPartnerAnswer, } from "../utils/relationships.js";
import { sendMatchNotification } from "../lib/line-messaging.js";
const likeSchema = z.object({
    targetUserId: z.string().uuid(),
    answer: z.enum(["YES", "NO"]),
});
const updateLikeSchema = z.object({
    answer: z.enum(["YES", "NO"]),
});
export const likesRouter = Router();
likesRouter.use(authMiddleware);
likesRouter.get("/next-candidate", async (req, res) => {
    const membership = await getApprovedMembership(req.user.userId);
    if (!membership) {
        return res.json({ candidate: null });
    }
    const userWhere = {
        id: { not: req.user.userId },
        memberships: {
            some: { communityId: membership.communityId, status: "approved" },
        },
    };
    if (!INCLUDE_SEED_USERS) {
        userWhere.profile = { is: { isSeedMember: false } };
    }
    const approvedMembers = await prisma.user.findMany({
        where: userWhere,
        include: { profile: true },
    });
    const existingLikes = await prisma.like.findMany({
        where: {
            fromUserId: req.user.userId,
            communityId: membership.communityId,
        },
        select: { toUserId: true },
    });
    const likedSet = new Set(existingLikes.map((l) => l.toUserId));
    const candidates = approvedMembers.filter((member) => !likedSet.has(member.id));
    if (candidates.length === 0) {
        return res.json({ candidate: null });
    }
    const candidate = candidates[Math.floor(Math.random() * candidates.length)];
    return res.json({
        candidate: {
            id: candidate.id,
            name: candidate.profile?.name || "",
            favoriteMeals: candidate.profile?.favoriteMeals || [],
        },
    });
});
likesRouter.post("/", async (req, res) => {
    const membership = await getApprovedMembership(req.user.userId);
    if (!membership) {
        return res.status(400).json({
            message: "コミュニティ参加後にご利用ください。先に参加コードで /api/community/join を呼び出してください。",
            status: "UNAPPLIED",
            action: "JOIN_REQUIRED",
        });
    }
    const parsed = likeSchema.safeParse(req.body);
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
            await tx.like.create({
                data: {
                    fromUserId: req.user.userId,
                    toUserId: parsed.data.targetUserId,
                    communityId: membership.communityId,
                    answer: parsed.data.answer,
                },
            });
            let matched = false;
            let matchedAt;
            let partnerName = "";
            let partnerFavoriteMeals = [];
            if (parsed.data.answer === "YES") {
                const reverse = await tx.like.findFirst({
                    where: {
                        fromUserId: parsed.data.targetUserId,
                        toUserId: req.user.userId,
                        communityId: membership.communityId,
                        answer: "YES",
                    },
                });
                if (reverse) {
                    const [user1Id, user2Id] = [
                        req.user.userId,
                        parsed.data.targetUserId,
                    ].sort();
                    const matchRecord = await tx.match.upsert({
                        where: {
                            user1Id_user2Id_communityId: {
                                user1Id,
                                user2Id,
                                communityId: membership.communityId,
                            },
                        },
                        update: {},
                        create: {
                            user1Id,
                            user2Id,
                            communityId: membership.communityId,
                        },
                    });
                    matched = true;
                    matchedAt = matchRecord.createdAt.toISOString();
                    const targetProfile = await tx.profile.findUnique({
                        where: { userId: parsed.data.targetUserId },
                    });
                    partnerName = targetProfile?.name || "";
                    partnerFavoriteMeals = targetProfile?.favoriteMeals || [];
                }
            }
            return { matched, matchedAt, partnerName, partnerFavoriteMeals };
        });
        if (result.matched) {
            const [self, partner] = await Promise.all([
                prisma.user.findUnique({
                    where: { id: req.user.userId },
                    select: { lineUserId: true, profile: { select: { name: true } } },
                }),
                prisma.user.findUnique({
                    where: { id: parsed.data.targetUserId },
                    select: { lineUserId: true, profile: { select: { name: true } } },
                }),
            ]);
            console.log("[MATCH POST] users for LINE", { self, partner });
            if (self?.lineUserId && partner?.profile?.name) {
                console.log("[LINE POST] sending to self");
                await sendMatchNotification(self.lineUserId, partner.profile.name);
            }
            else {
                console.warn("[LINE POST] skip self notification: missing lineUserId or partner name", {
                    selfLineUserId: self?.lineUserId,
                    partnerName: partner?.profile?.name,
                });
            }
            if (partner?.lineUserId && self?.profile?.name) {
                console.log("[LINE POST] sending to partner");
                await sendMatchNotification(partner.lineUserId, self.profile.name);
            }
            else {
                console.warn("[LINE POST] skip partner notification: missing lineUserId or self name", {
                    partnerLineUserId: partner?.lineUserId,
                    selfName: self?.profile?.name,
                });
            }
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
                .json({ message: "このユーザーには既に回答済みです" });
        }
        throw error;
    }
});
likesRouter.patch("/:targetUserId", async (req, res) => {
    if (req.user?.isAdmin) {
        return res.status(403).json({ message: "管理者はこの操作を行えません" });
    }
    const membership = await getApprovedMembership(req.user.userId);
    if (!membership) {
        return res.status(400).json({
            message: "コミュニティ参加後にご利用ください。先に参加コードで /api/community/join を呼び出してください。",
            status: "UNAPPLIED",
            action: "JOIN_REQUIRED",
        });
    }
    const targetIdResult = z.string().uuid().safeParse(req.params.targetUserId);
    if (!targetIdResult.success) {
        return res.status(400).json({ message: "Invalid target user id" });
    }
    const targetUserId = targetIdResult.data;
    const parsed = updateLikeSchema.safeParse(req.body);
    if (!parsed.success) {
        return res
            .status(400)
            .json({ message: "Invalid input", issues: parsed.error.flatten() });
    }
    try {
        await ensureSameCommunity(req.user.userId, targetUserId, membership.communityId);
    }
    catch (error) {
        return res.status(400).json({ message: error.message });
    }
    const existingLike = await prisma.like.findFirst({
        where: {
            fromUserId: req.user.userId,
            toUserId: targetUserId,
            communityId: membership.communityId,
        },
        include: { toUser: { include: { profile: true } } },
    });
    if (!existingLike) {
        return res.status(404).json({ message: "まだ回答していないユーザーです" });
    }
    if (existingLike.communityId !== membership.communityId) {
        return res.status(400).json({
            message: "対象ユーザーは同じコミュニティに所属していません",
        });
    }
    const currentMatch = await prisma.match.findFirst({
        where: {
            communityId: membership.communityId,
            OR: [
                { user1Id: req.user.userId, user2Id: targetUserId },
                { user1Id: targetUserId, user2Id: req.user.userId },
            ],
        },
    });
    if (parsed.data.answer === "NO" && currentMatch) {
        return res
            .status(400)
            .json({ message: "マッチ済みのユーザーにはNOを選択できません" });
    }
    if (existingLike.answer === parsed.data.answer) {
        const partnerLike = await prisma.like.findFirst({
            where: {
                fromUserId: targetUserId,
                toUserId: req.user.userId,
                communityId: membership.communityId,
            },
        });
        const payload = buildRelationshipPayload({
            like: existingLike,
            myAnswer: existingLike.answer,
            partnerAnswer: formatPartnerAnswer(partnerLike?.answer),
            matchRecord: currentMatch ?? undefined,
        });
        return res.json({
            updated: false,
            matched: payload.relationship.matched,
            nextSection: payload.nextSection,
            relationship: payload.relationship,
            targetUserId,
        });
    }
    const result = await prisma.$transaction(async (tx) => {
        await tx.like.update({
            where: { id: existingLike.id },
            data: { answer: parsed.data.answer },
        });
        if (parsed.data.answer === "YES") {
            const reverse = await tx.like.findFirst({
                where: {
                    fromUserId: targetUserId,
                    toUserId: req.user.userId,
                    communityId: membership.communityId,
                    answer: "YES",
                },
            });
            if (reverse) {
                const [user1Id, user2Id] = [req.user.userId, targetUserId].sort();
                const matchRecord = await tx.match.upsert({
                    where: {
                        user1Id_user2Id_communityId: {
                            user1Id,
                            user2Id,
                            communityId: membership.communityId,
                        },
                    },
                    update: {},
                    create: {
                        user1Id,
                        user2Id,
                        communityId: membership.communityId,
                    },
                });
                return { matchRecord };
            }
        }
        return { matchRecord: null };
    });
    const partnerLike = await prisma.like.findFirst({
        where: {
            fromUserId: targetUserId,
            toUserId: req.user.userId,
            communityId: membership.communityId,
        },
    });
    const payload = buildRelationshipPayload({
        like: existingLike,
        myAnswer: parsed.data.answer,
        partnerAnswer: formatPartnerAnswer(partnerLike?.answer),
        matchRecord: result.matchRecord ?? undefined,
    });
    if (payload.relationship.matched) {
        const [self, partner] = await Promise.all([
            prisma.user.findUnique({
                where: { id: req.user.userId },
                select: { lineUserId: true, profile: { select: { name: true } } },
            }),
            prisma.user.findUnique({
                where: { id: targetUserId },
                select: { lineUserId: true, profile: { select: { name: true } } },
            }),
        ]);
        console.log("[MATCH PATCH] users for LINE", { self, partner });
        if (self?.lineUserId && partner?.profile?.name) {
            console.log("[LINE PATCH] sending to self");
            await sendMatchNotification(self.lineUserId, partner.profile.name);
        }
        else {
            console.warn("[LINE PATCH] skip self notification: missing lineUserId or partner name", {
                selfLineUserId: self?.lineUserId,
                partnerName: partner?.profile?.name,
            });
        }
        if (partner?.lineUserId && self?.profile?.name) {
            console.log("[LINE PATCH] sending to partner");
            await sendMatchNotification(partner.lineUserId, self.profile.name);
        }
        else {
            console.warn("[LINE PATCH] skip partner notification: missing lineUserId or self name", {
                partnerLineUserId: partner?.lineUserId,
                selfName: self?.profile?.name,
            });
        }
    }
    res.json({
        updated: true,
        matched: payload.relationship.matched,
        nextSection: payload.nextSection,
        relationship: payload.relationship,
        targetUserId,
    });
});
