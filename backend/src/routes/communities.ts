import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/auth.js";

export const communitiesRouter = Router();

communitiesRouter.get("/:communityId/me/reaction-counts", authMiddleware, async (req, res) => {
  const userId = req.user?.userId;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { communityId } = req.params;
  try {
    const membership = await prisma.communityMembership.findUnique({
      where: { userId_communityId: { communityId, userId } }
    });
    if (!membership || membership.status !== "approved") {
      return res.status(404).json({ message: "Community not found" });
    }

    const [hearts, stars] = await Promise.all([
      prisma.like.count({
        where: { communityId, toUserId: userId, answer: "YES" }
      }),
      prisma.superLike.count({
        where: { communityId, toUserId: userId }
      })
    ]);

    return res.json({
      communityId,
      me: { id: userId },
      received: {
        hearts,
        stars
      }
    });
  } catch (err) {
    console.error("GET /api/communities/:communityId/me/reaction-counts failed", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});
