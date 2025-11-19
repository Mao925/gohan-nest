import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config({ path: process.env.ENV_PATH || '.env' });

const prisma = new PrismaClient();
const useSeedEnv = process.env.USE_SEED_MEMBERS ?? process.env.USE_SEED;
const enableSeedMembers = (useSeedEnv ?? 'true') !== 'false';

async function main() {
  const defaultCommunityName = process.env.DEFAULT_COMMUNITY_NAME || 'KING';
  const defaultCommunityCode = process.env.DEFAULT_COMMUNITY_CODE || 'KINGCODE';
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'changeme';

  const community = await prisma.community.upsert({
    where: { inviteCode: defaultCommunityCode },
    update: { name: defaultCommunityName },
    create: { name: defaultCommunityName, inviteCode: defaultCommunityCode }
  });

  let adminUser = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!adminUser) {
    adminUser = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: await bcrypt.hash(adminPassword, 10),
        isAdmin: true
      }
    });

    await prisma.profile.create({
      data: {
        userId: adminUser.id,
        name: 'Admin User',
        bio: 'Approves community requests.'
      }
    });
  }

  await prisma.communityMembership.upsert({
    where: { userId_communityId: { userId: adminUser.id, communityId: community.id } },
    update: { status: 'approved' },
    create: {
      userId: adminUser.id,
      communityId: community.id,
      status: 'approved'
    }
  });

  const sampleUsers = [
    {
      email: 'yuta@example.com',
      name: '森 ゆうた',
      bio: 'ラーメン屋を巡るのが趣味。落ち着いて話せる人とご飯に行きたい。',
      password: 'password',
      status: 'approved' as const
    },
    {
      email: 'sora@example.com',
      name: '林 そら',
      bio: '新しいカフェ開拓が大好き。写真好きな人と情報交換したいです。',
      password: 'password',
      status: 'approved' as const
    },
    {
      email: 'mei@example.com',
      name: '高橋 めい',
      bio: '仕事終わりにサクッと行けるディナー仲間募集中！',
      password: 'password',
      status: 'approved' as const
    },
    {
      email: 'pending@example.com',
      name: '仮メンバー ひなた',
      bio: 'まずはコミュニティ参加待ちです。',
      password: 'password',
      status: 'pending' as const
    }
  ];

  const userMap: Record<string, string> = { [adminUser.email]: adminUser.id };

  if (enableSeedMembers) {
    for (const user of sampleUsers) {
      const created = await prisma.user.upsert({
        where: { email: user.email },
        update: {},
        create: {
          email: user.email,
          passwordHash: await bcrypt.hash(user.password, 10),
          isAdmin: false
        }
      });

      userMap[user.email] = created.id;

      await prisma.profile.upsert({
        where: { userId: created.id },
        update: { name: user.name, bio: user.bio, isSeedMember: true },
        create: { userId: created.id, name: user.name, bio: user.bio, isSeedMember: true }
      });

      await prisma.communityMembership.upsert({
        where: { userId_communityId: { userId: created.id, communityId: community.id } },
        update: { status: user.status },
        create: {
          userId: created.id,
          communityId: community.id,
          status: user.status
        }
      });
    }

    const likeSeeds = [
      { from: 'yuta@example.com', to: 'sora@example.com', answer: 'YES' as const },
      { from: 'sora@example.com', to: 'yuta@example.com', answer: 'YES' as const },
      { from: 'yuta@example.com', to: 'mei@example.com', answer: 'NO' as const },
      { from: 'mei@example.com', to: 'admin@example.com', answer: 'YES' as const }
    ];

    for (const like of likeSeeds) {
      const fromUserId = userMap[like.from];
      const toUserId = userMap[like.to];
      if (!fromUserId || !toUserId) continue;

      await prisma.like.upsert({
        where: {
          fromUserId_toUserId_communityId: {
            fromUserId,
            toUserId,
            communityId: community.id
          }
        },
        update: { answer: like.answer },
        create: {
          fromUserId,
          toUserId,
          communityId: community.id,
          answer: like.answer
        }
      });
    }

    const matchPairs = [
      ['sora@example.com', 'yuta@example.com'] // mutual YES
    ];

    for (const [aEmail, bEmail] of matchPairs) {
      const ids = [userMap[aEmail], userMap[bEmail]].filter(Boolean) as string[];
      if (ids.length !== 2) continue;
      ids.sort();
      await prisma.match.upsert({
        where: {
          user1Id_user2Id_communityId: {
            user1Id: ids[0],
            user2Id: ids[1],
            communityId: community.id
          }
        },
        update: {},
        create: {
          user1Id: ids[0],
          user2Id: ids[1],
          communityId: community.id
        }
      });
    }
    console.log('Seed completed with sample members, likes, and matches.');
  } else {
    console.log('USE_SEED flag disabled sample member creation.');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
