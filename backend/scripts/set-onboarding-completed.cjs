require("dotenv").config({ path: "./.env" }); // ★ 追加：.env を読み込む

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.user.updateMany({
    data: { hasCompletedOnboarding: true },
    where: { hasCompletedOnboarding: false },
  });

  console.log(`Updated ${result.count} users`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
