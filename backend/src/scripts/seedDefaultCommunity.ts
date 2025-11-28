// backend/src/scripts/seedDefaultCommunity.ts
import { prisma } from '../lib/prisma.js';
import {
  DEFAULT_COMMUNITY_NAME,
  DEFAULT_COMMUNITY_CODE,
} from '../config.js';

async function main() {
  if (!DEFAULT_COMMUNITY_NAME || !DEFAULT_COMMUNITY_CODE) {
    throw new Error(
      'DEFAULT_COMMUNITY_NAME / DEFAULT_COMMUNITY_CODE が設定されていません。.env を確認してください。'
    );
  }

  const community = await prisma.community.upsert({
    where: { inviteCode: DEFAULT_COMMUNITY_CODE },
    update: {},
    create: {
      name: DEFAULT_COMMUNITY_NAME,
      inviteCode: DEFAULT_COMMUNITY_CODE,
    },
  });

  console.log('✅ Default community ensured:', community);
}

main()
  .catch((e) => {
    console.error('❌ Seed default community failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
