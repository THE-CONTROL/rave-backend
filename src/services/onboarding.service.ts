/**
 * src/services/onboarding.service.ts
 * Onboarding slides stored in DB — admin can update without deployment.
 */

import { prisma } from "../config/database";

export const getSlides = async (role: string) => {
  const slides = await prisma.onboardingSlide.findMany({
    where: { role, isActive: true },
    orderBy: { order: "asc" },
    select: {
      order: true,
      title: true,
      description: true,
      bullets: true,
      imageUrl: true,
    },
  });

  return slides.map((s) => ({
    id: s.order,
    title: s.title,
    description: s.description ?? undefined,
    bullets: s.bullets.length > 0 ? s.bullets : undefined,
    image: s.imageUrl ?? "",
  }));
};

const img = (id: string) =>
  `https://images.unsplash.com/photo-${id}?w=600&h=600&fit=crop&auto=format`;

const DEFAULTS = [
  {
    role: "user",
    order: 1,
    title: "Craving something good?",
    description: "Explore trusted food vendors around you.",
    imageUrl: img("1504674900247-0877df9cc836"),
    bullets: [] as string[],
  },
  {
    role: "user",
    order: 2,
    title: "Order in seconds.",
    description: "Add to cart, checkout quickly, and track your delivery.",
    imageUrl: img("1526367790999-0150786686a2"),
    bullets: [] as string[],
  },
  {
    role: "user",
    order: 3,
    title: "Fresh food. Reliable delivery.",
    description: "Rated vendors, secure payments, and support.",
    imageUrl: img("1567637347853-ef9d72c81f4f"),
    bullets: [] as string[],
  },
  {
    role: "vendor",
    order: 1,
    title: "Reach more customers.",
    description: "List your menu and get discovered by hungry customers.",
    imageUrl: img("1555396273-359ea4978bb7"),
    bullets: [] as string[],
  },
  {
    role: "vendor",
    order: 2,
    title: "Manage orders easily.",
    description: "Accept, track, and fulfil orders from one simple dashboard.",
    imageUrl: img("1546069901-ba9599a7e63c"),
    bullets: [] as string[],
  },
  {
    role: "vendor",
    order: 3,
    title: "Grow your business.",
    description:
      "Get insights, reviews, and tools to help your food business thrive.",
    imageUrl: img("1504674900247-0877df9cc836"),
    bullets: [] as string[],
  },
  {
    role: "rider",
    order: 1,
    title: "Deliver in your area, earn fast",
    description: "Pick up orders nearby and get paid instantly.",
    imageUrl: img("1558618666-fcd25c85cd64"),
    bullets: [] as string[],
  },
  {
    role: "rider",
    order: 2,
    title: "How Rave Works for You",
    description: undefined,
    imageUrl: img("1526367790999-0150786686a2"),
    bullets: [
      "See orders nearby.",
      "Pick up & deliver — follow the map.",
      "Earn instantly after delivery.",
    ] as string[],
  },
  {
    role: "rider",
    order: 3,
    title: "Ready to Ride with Rave?",
    description: "Sign up now and start delivering with us.",
    imageUrl: img("1609205807107-2fc33a9d8bbc"),
    bullets: [] as string[],
  },
];

export const seedOnboardingSlides = async (): Promise<void> => {
  const count = await prisma.onboardingSlide.count();
  if (count > 0) return;
  await prisma.onboardingSlide.createMany({ data: DEFAULTS });
};
