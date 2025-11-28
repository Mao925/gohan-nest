// backend/src/scripts/resetUser.ts
import 'dotenv/config';
import { prisma } from '../lib/prisma.js';

async function resetUser(userId: string) {
  console.log(`[RESET USER] start for userId=${userId}`);

  // 0. ユーザー存在チェック
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) {
    console.error(`[RESET USER] user not found: ${userId}`);
    return;
  }

  // 1. このユーザーがホストしているグループご飯を取得
  const hostedMeals = await prisma.groupMeal.findMany({
    where: { hostUserId: userId },
    select: { id: true },
  });
  const hostedMealIds = hostedMeals.map((m) => m.id);

  if (hostedMealIds.length > 0) {
    console.log(
      `[RESET USER] hosted group meals found: ${hostedMealIds.length}`
    );

    // 1-1. そのグループご飯に紐づく参加者を削除
    await prisma.groupMealParticipant.deleteMany({
      where: {
        groupMealId: { in: hostedMealIds },
      },
    });

    // 1-2. グループご飯本体を削除
    await prisma.groupMeal.deleteMany({
      where: {
        id: { in: hostedMealIds },
      },
    });
  }

  // 2. 他人がホストのグループご飯に参加しているレコードを削除
  await prisma.groupMealParticipant.deleteMany({
    where: {
      userId,
    },
  });

  // 3. いいね（from / to 両方）
  await prisma.like.deleteMany({
    where: {
      OR: [{ fromUserId: userId }, { toUserId: userId }],
    },
  });

  // 4. マッチ（user1 / user2 両方）
  await prisma.match.deleteMany({
    where: {
      OR: [{ user1Id: userId }, { user2Id: userId }],
    },
  });

  // 5. コミュニティメンバーシップ
  await prisma.communityMembership.deleteMany({
    where: {
      userId,
    },
  });

  // 6. 空き時間スロット
  await prisma.availabilitySlot.deleteMany({
    where: {
      userId,
    },
  });

  // 7. プロフィール
  await prisma.profile.deleteMany({
    where: {
      userId,
    },
  });

  // 8. 最後にユーザー本体（ログイン情報も含めて完全削除）
  await prisma.user.delete({
    where: {
      id: userId,
    },
  });

  console.log(`[RESET USER] done for userId=${userId}`);
}

async function main() {
  const userId = process.argv[2];
  if (!userId) {
    console.error(
      'Usage: node --loader ts-node/esm src/scripts/resetUser.ts <userId>'
    );
    process.exit(1);
  }

  try {
    await resetUser(userId);
  } catch (err) {
    console.error('[RESET USER] error', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
