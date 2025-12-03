import { prisma } from '../lib/prisma.js';
import { AutoGroupCandidate } from './groupMealAutoCandidates.js';
import { GroupMealMode } from '@prisma/client';

const MAX_GROUP_SIZE = 6;

type GroupPlan = {
  userIds: string[];
};

type AffinityParams = {
  likeSet: Set<string>;
  candidateMap: Map<string, AutoGroupCandidate>;
};

function getRelationshipWeight(
  a: AutoGroupCandidate,
  b: AutoGroupCandidate,
  likeSet: Set<string>
): number {
  const forward = likeSet.has(`${a.userId}:${b.userId}`);
  const backward = likeSet.has(`${b.userId}:${a.userId}`);
  if (forward && backward) {
    return 2;
  }
  if (forward || backward) {
    return 1;
  }
  return 0;
}

function computeProfileSimilarity(
  a: AutoGroupCandidate,
  b: AutoGroupCandidate
): number {
  const profileA = a.profile;
  const profileB = b.profile;
  if (!profileA || !profileB) {
    return 0;
  }

  let score = 0;

  if (profileA.mainArea && profileB.mainArea && profileA.mainArea === profileB.mainArea) {
    score += 2;
  }

  const sharedHobbies = (profileA.hobbies ?? []).filter((hobby) =>
    (profileB.hobbies ?? []).includes(hobby)
  );
  score += Math.min(sharedHobbies.length, 3);

  const sharedMeals = (profileA.favoriteMeals ?? []).filter((meal) =>
    (profileB.favoriteMeals ?? []).includes(meal)
  );
  score += Math.min(sharedMeals.length, 2);

  return score;
}

function computeAffinity(
  a: AutoGroupCandidate,
  b: AutoGroupCandidate,
  likeSet: Set<string>
): number {
  const relationshipWeight = getRelationshipWeight(a, b, likeSet);
  const similarity = computeProfileSimilarity(a, b);
  return relationshipWeight * 10 + similarity;
}

export async function groupCandidatesIntoBoxes(params: {
  candidates: AutoGroupCandidate[];
  communityId: string;
  mode: GroupMealMode;
}): Promise<GroupPlan[]> {
  const { candidates, communityId } = params;
  if (candidates.length < 2) {
    return [];
  }
  if (candidates.length <= MAX_GROUP_SIZE) {
    return [{ userIds: candidates.map((candidate) => candidate.userId) }];
  }

  const userIds = candidates.map((candidate) => candidate.userId);
  const likes = await prisma.like.findMany({
    where: {
      communityId,
      fromUserId: { in: userIds },
      toUserId: { in: userIds },
      answer: 'YES'
    },
    select: {
      fromUserId: true,
      toUserId: true
    }
  });

  const likeSet = new Set(likes.map((like) => `${like.fromUserId}:${like.toUserId}`));
  const candidateMap = new Map(candidates.map((candidate) => [candidate.userId, candidate]));
  const pool = [...candidates];
  const groups: GroupPlan[] = [];

  while (pool.length > 0) {
    const seed = pool.shift()!;
    const groupMembers = [seed];

    pool.sort(
      (a, b) =>
        computeAffinity(b, seed, likeSet) - computeAffinity(a, seed, likeSet)
    );

    while (groupMembers.length < MAX_GROUP_SIZE && pool.length > 0) {
      groupMembers.push(pool.shift()!);
    }

    groups.push({ userIds: groupMembers.map((candidate) => candidate.userId) });
  }

  if (groups.length > 1) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup.userIds.length === 1) {
      const singletonId = lastGroup.userIds[0];
      const singletonCandidate = candidateMap.get(singletonId);
      groups.pop();

      if (singletonCandidate) {
        let bestIndex = -1;
        let bestScore = -Infinity;

        for (let i = 0; i < groups.length; i += 1) {
          if (groups[i].userIds.length >= MAX_GROUP_SIZE) {
            continue;
          }
          const existingMembers = groups[i]
            .userIds
            .map((id) => candidateMap.get(id))
            .filter((candidate): candidate is AutoGroupCandidate => Boolean(candidate));
          if (!existingMembers.length) continue;

          const affinitySum = existingMembers.reduce(
            (sum, member) => sum + computeAffinity(singletonCandidate, member, likeSet),
            0
          );
          const avgScore = affinitySum / existingMembers.length;
          if (avgScore > bestScore) {
            bestScore = avgScore;
            bestIndex = i;
          }
        }

        if (bestIndex >= 0) {
          groups[bestIndex].userIds.push(singletonId);
        } else {
          groups.push({ userIds: [singletonId] });
        }
      } else {
        groups.push({ userIds: [singletonId] });
      }
    }
  }

  return groups;
}

export type { GroupPlan };
