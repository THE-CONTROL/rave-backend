// prisma/seed.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // ── Sample advertisement ────────────────────────────────────────────────────
  await prisma.advertisement.upsert({
    where: { id: "ad-user-001" },
    update: {},
    create: {
      id: "ad-user-001",
      type: "image",
      contentUri:
        "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=600",
      headline: "50% Off Your First Order!",
      bodyText: "Use code WELCOME50 at checkout.",
      ctaText: "Order Now",
      targetRole: "user",
      isActive: true,
    },
  });

  await prisma.advertisement.upsert({
    where: { id: "ad-vendor-001" },
    update: {},
    create: {
      id: "ad-vendor-001",
      type: "image",
      contentUri:
        "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=600",
      headline: "Boost Your Sales",
      bodyText: "Upgrade to Pro and get featured on the home page.",
      ctaText: "Upgrade Now",
      targetRole: "vendor",
      isActive: true,
    },
  });

  console.log("✅ Seed complete!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
