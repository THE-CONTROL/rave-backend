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

/**
 * Unsplash Source API — returns a random photo matching the given keywords.
 * The `sig` query keeps each slide's photo stable across requests (Unsplash
 * caches by URL); without it, every fetch could return a different image.
 *
 * NOTE: This endpoint was deprecated by Unsplash in 2024 and is best-effort.
 * For production, replace these URLs with images hosted on Cloudinary
 * (we already use Cloudinary elsewhere) so onboarding never breaks on a
 * third-party outage.
 */
const img = (keywords: string, sig: number) =>
  `https://source.unsplash.com/600x600/?${encodeURIComponent(keywords)}&sig=${sig}`;

const DEFAULTS = [
  // ─────────────────────────────────────────────────────────────────────────
  // USER — discovering food, ordering quickly, trust & reliability
  // ─────────────────────────────────────────────────────────────────────────
  {
    role: "user",
    order: 1,
    title: "Craving something good?",
    description:
      "Browse trusted restaurants and street-food vendors near you — from quick bites to full meals, all in one place.",
    imageUrl: img("nigerian food,jollof rice,african cuisine", 101),
    bullets: [] as string[],
  },
  {
    role: "user",
    order: 2,
    title: "Order in seconds.",
    description:
      "Add items to your cart, customise your meal, pay securely, and watch your rider's progress on the map in real time.",
    imageUrl: img("mobile food ordering,smartphone restaurant app", 102),
    bullets: [] as string[],
  },
  {
    role: "user",
    order: 3,
    title: "Fresh food. Reliable delivery.",
    description:
      "Real reviews from real customers, secure card payments, and a support team that picks up when things go wrong.",
    imageUrl: img("food delivery rider,motorbike courier", 103),
    bullets: [] as string[],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // VENDOR — visibility, easy management, growth
  // ─────────────────────────────────────────────────────────────────────────
  {
    role: "vendor",
    order: 1,
    title: "Reach more customers.",
    description:
      "List your menu in minutes and put your kitchen in front of thousands of hungry locals searching for their next meal.",
    imageUrl: img("restaurant kitchen,chef cooking,african restaurant", 201),
    bullets: [] as string[],
  },
  {
    role: "vendor",
    order: 2,
    title: "Manage orders, your way.",
    description:
      "Accept or decline orders, capture packing videos for proof, and track every delivery from a clean, simple dashboard.",
    imageUrl: img("restaurant owner tablet,kitchen management", 202),
    bullets: [] as string[],
  },
  {
    role: "vendor",
    order: 3,
    title: "Grow your food business.",
    description:
      "See what's selling, what your customers say, and exactly how much you earned today — with daily payouts straight to your bank.",
    imageUrl: img("restaurant business growth,small business owner", 203),
    bullets: [] as string[],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // RIDER — earn nearby, simple flow, get started
  // ─────────────────────────────────────────────────────────────────────────
  {
    role: "rider",
    order: 1,
    title: "Deliver nearby. Earn fast.",
    description:
      "Pick up orders from restaurants close to you and get paid the moment each delivery is confirmed — no waiting for payday.",
    imageUrl: img("delivery rider motorcycle,food courier bike", 301),
    bullets: [] as string[],
  },
  {
    role: "rider",
    order: 2,
    title: "How Rave works for you",
    description: undefined,
    imageUrl: img("motorbike delivery map,navigation rider", 302),
    bullets: [
      "See nearby orders the moment they come in.",
      "Pick up and deliver — the map guides every turn.",
      "Earnings hit your wallet the second you confirm drop-off.",
    ] as string[],
  },
  {
    role: "rider",
    order: 3,
    title: "Ready to ride with Rave?",
    description:
      "Sign up in minutes, verify your bike, and start earning today — work the hours you want, where you want.",
    imageUrl: img("motorcycle rider helmet,delivery driver portrait", 303),
    bullets: [] as string[],
  },
];

export const seedOnboardingSlides = async (): Promise<void> => {
  const count = await prisma.onboardingSlide.count();
  if (count > 0) return;
  await prisma.onboardingSlide.createMany({ data: DEFAULTS });
};
