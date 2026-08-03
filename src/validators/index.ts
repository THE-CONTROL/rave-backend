import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────────────

export const signUpSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  phoneNumber: z
    .string()
    .min(10, "Phone number too short")
    .max(15, "Phone number too long")
    .regex(/^\+?[0-9]+$/, "Invalid phone number"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(
      /[!@#$%^&*(),.?":{}|<>]/,
      "Password must contain at least one special character",
    ),
  role: z.enum(["user", "vendor", "rider"]),
  // Optional referral code entered at signup. Trimmed/empty becomes undefined.
  referralCode: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export const signInSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(1, "Password is required"),
  audience: z.enum(["rave", "ridewithrave", "rave-admin"]),
});

export const verifyEmailSchema = z.object({
  code: z.string().length(6, "Code must be 6 digits"),
  purpose: z.enum(["verify-account", "reset-password"]),
  role: z.enum(["user", "vendor", "rider"]).optional(),
  email: z.string().email("Invalid email"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email"),
  purpose: z.enum(["verify-account", "reset-password"]),
});

export const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(
        /[!@#$%^&*(),.?":{}|<>]/,
        "Password must contain at least one special character",
      ),
    confirmPassword: z.string(),
    email: z.string().email().optional(), // Used in forgot-password flow
    // The OTP code the user just verified — required proof of email ownership
    // before a password can actually be changed.
    code: z.string().length(6, "Code must be 6 digits"),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

export const resendCodeSchema = z.object({
  email: z.string().email("Invalid email"),
  purpose: z.enum(["verify-account", "reset-password"]),
});

export const pushTokenSchema = z.object({
  token: z.string().min(1, "Push token is required"),
});

// ─────────────────────────────────────────────────────────────────────────────
// User profile
// ─────────────────────────────────────────────────────────────────────────────

export const updateProfileSchema = z.object({
  fullName: z.string().min(2).optional(),
  phone: z.string().min(10).optional(),
  imageUrl: z.string().url().optional(),
  location: z.string().optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password required"),
    newPassword: z.string().min(8, "New password too short"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

// ─────────────────────────────────────────────────────────────────────────────
// Location
// ─────────────────────────────────────────────────────────────────────────────

export const locationSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(5),
  latitude: z.number(),
  longitude: z.number(),
  type: z.enum(["home", "work", "other"]),
  instructions: z.string().optional(),
  isDefault: z.boolean().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Cart / checkout
// ─────────────────────────────────────────────────────────────────────────────

export const addToCartSchema = z.object({
  menuItemId: z.string().uuid(),
  qty: z.number().int().positive().max(20),
  extras: z.array(z.string().uuid()).optional(), // array of ingredient IDs
});

export const updateCartItemSchema = z.object({
  qty: z.number().int().min(0).max(20),
  extras: z.array(z.string().uuid()).optional(),
});

export const initializePaymentSchema = z.object({
  savedLocationId: z.string().uuid(),
  paymentMethod: z.enum(["card", "bank_transfer"]),
  instructions: z.string().optional(),
  contactMethod: z.enum(["in-app", "normal"]).default("in-app"),
});

export const createOrderSchema = z.object({
  savedLocationId: z.string().uuid(),
  paymentMethod: z.enum(["card", "bank_transfer"]),
  instructions: z.string().optional(),
  contactMethod: z.enum(["in-app", "normal"]).default("in-app"),
  reference: z.string().min(1), // Paystack reference — required
});

// ─────────────────────────────────────────────────────────────────────────────
// Orders
// ─────────────────────────────────────────────────────────────────────────────

export const cancelOrderSchema = z.object({
  reason: z.string().min(5, "Please provide a cancellation reason"),
});

export const reportReviewSchema = z.object({
  reason: z.enum(["inappropriate", "spam", "fake", "other"]),
  comment: z.string().max(500).optional(),
});

export const reviewSchema = z.object({
  restaurantRating: z.number().int().min(1).max(5),
  foodRating: z.number().int().min(1).max(5),
  riderRating: z.number().int().min(1).max(5),
  tags: z.array(z.string()).optional().default([]),
  comment: z.string().max(1000).optional(),
  riderComment: z.string().max(500).optional(),
  proofUrls: z.array(z.string()).optional().default([]),
  menuItemIds: z.array(z.string()).optional().default([]),
  resolutionPreference: z.string().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Refunds
// ─────────────────────────────────────────────────────────────────────────────

export const refundRequestSchema = z.object({
  orderId: z.string().uuid(),
  issue: z.string().min(3),
  description: z.string().min(10, "Description too short"),
  amountRequested: z.number().positive(),
  items: z.array(
    z.object({ name: z.string(), qty: z.number().int().positive() }),
  ),
});

// ─────────────────────────────────────────────────────────────────────────────
// Referral
// ─────────────────────────────────────────────────────────────────────────────

export const applyReferralSchema = z.object({
  code: z.string().min(4, "Invalid referral code"),
});

// ─────────────────────────────────────────────────────────────────────────────
// Vendor — store settings
// ─────────────────────────────────────────────────────────────────────────────

export const updateStoreSchema = z.object({
  storeName: z.string().min(2).optional(),
  address: z.string().min(5).optional(),
  description: z.string().max(500).optional(),
  isOpen: z.boolean().optional(),
  autoAcceptOrders: z.boolean().optional(),
  hoursSummary: z.string().optional(),
  bannerUrl: z.string().url().optional().nullable(),
  logoUrl: z.string().url().optional().nullable(),
  // Coordinates sent by the store-details location picker. These were missing,
  // so the validate() middleware (which replaces req.body with the parsed,
  // unknown-key-stripped result) silently dropped them and lat/lng never
  // reached the service. Accept the frontend's latitude/longitude names here.
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

export const storeScheduleSchema = z.object({
  schedules: z.array(
    z.object({
      day: z.string().min(2),
      openTime: z.string().regex(/^\d{2}:\d{2}$/, "Format: HH:MM"),
      closeTime: z.string().regex(/^\d{2}:\d{2}$/, "Format: HH:MM"),
    }),
  ),
});

// ─────────────────────────────────────────────────────────────────────────────
// Vendor — category
// ─────────────────────────────────────────────────────────────────────────────

export const createCategorySchema = z.object({
  name: z.string().min(2, "Category name too short"),
  description: z.string().optional(),
  imageUrl: z.string().url().optional(),
});

export const updateCategorySchema = createCategorySchema
  .extend({
    isActive: z.boolean().optional(),
  })
  .partial();

export const deleteBatchSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "At least one ID required"),
});

export const addItemsToCategorySchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1),
});

// ─────────────────────────────────────────────────────────────────────────────
// Vendor — menu item
// ─────────────────────────────────────────────────────────────────────────────

// ── Ingredient Schema ──
const ingredientSchema = z.object({
  name: z.string().min(1, "Ingredient name is required"),
  portion: z.string().min(1, "Portion (e.g. 2 Spoons) is required"),
  mealType: z.string().min(1, "Meal type is required"),
  isOptional: z.boolean().default(false),
  price: z.number().nonnegative("Price cannot be negative").default(0),
});

// ── Image Object Schema ──
const menuItemImageSchema = z.object({
  url: z.string().url("Invalid image URL"),
  main: z.boolean().default(false),
});

// ── Create Menu Item Schema ──
export const createMenuItemSchema = z.object({
  name: z.string().min(2, "Name is too short"),
  description: z.string().min(10, "Please provide a more detailed description"),
  price: z.number().positive("Price must be a positive number"),
  // Updated to validate the object structure
  images: z.array(menuItemImageSchema).min(1, "Upload at least one image"),
  isCustomizable: z.boolean().default(false),
  categoryIds: z
    .array(z.string().uuid())
    .min(1, "Select at least one category"),
  ingredients: z
    .array(ingredientSchema)
    .min(1, "At least one item must be added to the meal"),
  optionGroupIds: z.array(z.string().uuid()).optional().default([]),
});

// ── Update Menu Item Schema ──
export const updateMenuItemSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().min(10).optional(),
  price: z.number().positive().optional(),
  images: z
    .array(menuItemImageSchema)
    .min(1, "Upload at least one image")
    .optional(),
  isActive: z.boolean().optional(),
  isBestSeller: z.boolean().optional(),
  isCustomizable: z.boolean().optional(),
  categoryIds: z.array(z.string().uuid()).optional(),
  ingredients: z.array(ingredientSchema).optional(),
  optionGroupIds: z.array(z.string().uuid()).optional(),
});
// ─────────────────────────────────────────────────────────────────────────────
// Vendor — order status
// ─────────────────────────────────────────────────────────────────────────────

export const updateOrderStatusSchema = z.object({
  id: z.string(),
  status: z.enum(["accepted", "preparing", "ready", "completed", "cancelled"]),
  cancelReason: z.string().optional(),
});

export const uploadEvidenceSchema = z.object({
  url: z.string().url(),
});

export const declineRefundSchema = z.object({
  reason: z.string().min(3, "Please provide a reason").optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Vendor — promotion
// ─────────────────────────────────────────────────────────────────────────────

export const createPromotionSchema = z
  .object({
    title: z.string().min(3, "Title must be at least 3 characters"),
    subtitle: z.string().optional(),
    type: z.string().min(2, "Invalid promotion type"),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    description: z.string().optional(),
    discountValue: z.number().nonnegative().optional().default(0),
    promoCode: z.string().optional(),
    minimumOrder: z.number().nonnegative().optional().default(0),
    maxUses: z.number().int().positive().optional(),
    // Added fields to match implementation
    appliesTo: z.enum(["all", "specific"]),
    productIds: z.array(z.string().uuid()).optional().default([]),
  })
  .refine((data) => data.endDate > data.startDate, {
    message: "End date must be after start date",
    path: ["endDate"],
  });

export const updatePromotionSchema = z
  .object({
    title: z.string().min(3).optional(),
    subtitle: z.string().optional(),
    isActive: z.boolean().optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    description: z.string().optional(),
    discountValue: z.number().nonnegative().optional(),
    promoCode: z.string().optional(),
    minimumOrder: z.number().nonnegative().optional(),
    maxUses: z.number().int().positive().optional(),
    // Added fields for editing product scope
    appliesTo: z.enum(["all", "specific"]).optional(),
    productIds: z.array(z.string().uuid()).optional(),
  })
  .refine(
    (data) =>
      !data.startDate || !data.endDate || data.endDate > data.startDate,
    {
      message: "End date must be after start date",
      path: ["endDate"],
    },
  );

// ─────────────────────────────────────────────────────────────────────────────
// Vendor — payout
// ─────────────────────────────────────────────────────────────────────────────

export const saveBankSchema = z.object({
  bank: z.string().min(2),
  name: z.string().min(2),
  accountNumber: z.string().min(10).max(10),
  bankCode: z.string().optional(),
});

export const vendorWithdrawSchema = z.object({
  amount: z.number().positive("Enter a valid withdrawal amount"),
  bankAccountId: z.string().uuid("Invalid bank account"),
});

// ─────────────────────────────────────────────────────────────────────────────
// Policy / Issues
// ─────────────────────────────────────────────────────────────────────────────

export const submitIssueSchema = z.object({
  urgency: z.string().min(1),
  category: z.string().min(1),
  transactionId: z.string().optional(),
  description: z.string().min(20, "Please describe the issue in more detail"),
});

export const submitFeedbackSchema = z.object({
  type: z.string().min(1),
  message: z.string().min(5, "Message too short"),
});

// ─────────────────────────────────────────────────────────────────────────────
// Ads
// ─────────────────────────────────────────────────────────────────────────────

export const trackAdEventSchema = z.object({
  adId: z.string().uuid(),
  event: z.enum(["view", "click", "skip", "complete"]),
  durationViewed: z.number().int().min(0),
});

// ─────────────────────────────────────────────────────────────────────────────
// Reviews (update)
// ─────────────────────────────────────────────────────────────────────────────

export const updateReviewSchema = z.object({
  restaurantRating: z.number().int().min(1).max(5).optional(),
  foodRating: z.number().int().min(1).max(5).optional(),
  riderRating: z.number().int().min(1).max(5).optional(),
  tags: z.array(z.string()).optional(),
  comment: z.string().max(500).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Bank resolution
// ─────────────────────────────────────────────────────────────────────────────

export const resolveBankSchema = z.object({
  bankCode: z.string().min(2, "Bank code required"),
  accountNumber: z.string().length(10, "Account number must be 10 digits"),
});

// ─────────────────────────────────────────────────────────────────────────────
// Vendor bank (save)
// ─────────────────────────────────────────────────────────────────────────────

export const vendorSaveBankSchema = z.object({
  bank: z.string().min(2, "Bank name required"),
  name: z.string().min(2, "Account name required"),
  accountNumber: z.string().length(10, "Account number must be 10 digits"),
  bankCode: z.string().optional(),
});

// Vendor bank (update) — unlike the create schema above (which mirrors the
// legacy `bank`/`name` naming the create screen still sends), the edit screen
// (Rave/app/authenticated/bank/[role]/addnewaccount.tsx's `isEditing` branch)
// already sends the real, readable Prisma column names directly, so this
// validates against those instead of introducing another `bank`/`name` alias.
export const vendorUpdateBankSchema = z.object({
  bankName: z.string().min(2, "Bank name required").optional(),
  accountName: z.string().min(2, "Account name required").optional(),
  accountNumber: z
    .string()
    .length(10, "Account number must be 10 digits")
    .optional(),
  bankCode: z.string().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Rider validators
// ─────────────────────────────────────────────────────────────────────────────

export const riderUpdateProfileSchema = z.object({
  fullName: z.string().min(2).optional(),
  phone: z.string().min(7).optional(),
  imageUrl: z.string().url().optional(),
  vehicleType: z.enum(["bike", "car", "bicycle"]).optional(),
  vehiclePlate: z.string().min(3).optional(),
});

export const riderToggleOnlineSchema = z.object({
  isOnline: z.boolean(),
});

export const riderLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().optional(),
});

export const riderAcceptOrderSchema = z.object({
  orderId: z.string().uuid(),
});

export const riderDeliveryStatusSchema = z.object({
  status: z.enum(["pending", "ongoing", "delivered", "cancelled"]),
});

export const riderOtpSchema = z.object({
  otp: z.string().min(1),
});

export const riderIssueSchema = z.object({
  issues: z.array(z.string()).min(1),
  note: z.string().max(500),
  attachments: z.array(z.string()).optional(),
});

// Matches what RideWithRave/app/authenticated/transactions/bank/addnewaccount.tsx
// actually posts (bankName/accountName), rather than forcing the frontend to
// adopt the more cryptic bank/name naming used by the vendor's legacy schema.
export const riderSaveBankSchema = z.object({
  bankName: z.string().min(2, "Bank name required"),
  accountName: z.string().min(2, "Account name required"),
  accountNumber: z.string().length(10, "Account number must be 10 digits"),
  bankCode: z.string().optional(),
});

export const riderUpdateBankSchema = z.object({
  bankName: z.string().min(2, "Bank name required").optional(),
  accountName: z.string().min(2, "Account name required").optional(),
  accountNumber: z
    .string()
    .length(10, "Account number must be 10 digits")
    .optional(),
  bankCode: z.string().optional(),
});

export const riderWithdrawSchema = z.object({
  amount: z.number().positive("Enter a valid withdrawal amount"),
  bankAccountId: z.string().uuid("Invalid bank account"),
});

export const riderNotificationSettingsSchema = z.object({
  newOrders: z.boolean().optional(),
  orderStatusUpdates: z.boolean().optional(),
  riderArrival: z.boolean().optional(),
  promos: z.boolean().optional(),
  performanceTips: z.boolean().optional(),
  reviews: z.boolean().optional(),
  sound: z.string().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin
// ─────────────────────────────────────────────────────────────────────────────

const adminRoleEnum = z.enum([
  "super_admin",
  "support",
  "ops",
  "finance",
  "content",
]);

export const createAdminSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  phoneNumber: z
    .string()
    .min(10, "Phone number too short")
    .max(15, "Phone number too long")
    .regex(/^\+?[0-9]+$/, "Invalid phone number"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(
      /[!@#$%^&*(),.?":{}|<>]/,
      "Password must contain at least one special character",
    ),
  adminRole: adminRoleEnum,
});

export const updateAdminSchema = z.object({
  adminRole: adminRoleEnum.optional(),
  isActive: z.boolean().optional(),
});

// ── Config ──
export const updateConfigSchema = z.object({
  value: z.string().min(1),
});

// ── Ads ──
export const createAdSchema = z.object({
  type: z.enum(["video", "image", "audio", "text"]),
  contentUri: z.string().url().optional(),
  headline: z.string().optional(),
  bodyText: z.string().optional(),
  ctaText: z.string().optional(),
  ctaUrl: z.string().url().optional(),
  duration: z.number().int().positive().optional(),
  targetRole: z.enum(["user", "vendor", "rider"]).optional(),
  isActive: z.boolean().default(true),
});

export const updateAdSchema = createAdSchema.partial();

// ── Onboarding slides ──
export const createOnboardingSlideSchema = z.object({
  role: z.enum(["user", "vendor", "rider"]),
  order: z.number().int(),
  title: z.string().min(1),
  description: z.string().optional(),
  bullets: z.array(z.string()).default([]),
  imageUrl: z.string().url().optional(),
  isActive: z.boolean().default(true),
});

export const updateOnboardingSlideSchema = createOnboardingSlideSchema.partial();

export const reorderOnboardingSlidesSchema = z.object({
  role: z.enum(["user", "vendor", "rider"]),
  orderedIds: z.array(z.string().uuid()).min(1),
});

// ── Vendor approval ──
export const denyVendorSchema = z.object({
  reason: z.string().min(3, "Please provide a reason"),
});

export const suspendVendorSchema = z.object({
  reason: z.string().min(3, "Please provide a reason").optional(),
});

// ── Rider verification ──
export const rejectRiderSchema = z.object({
  field: z.enum(["bike", "plate", "id", "selfie", "residence"]),
  reason: z.string().min(3, "Please provide a reason"),
});

export const suspendRiderSchema = z.object({
  reason: z.string().min(3, "Please provide a reason").optional(),
});

// ── Support tickets ──
export const updateIssueStatusSchema = z.object({
  status: z.enum(["OPEN", "IN_REVIEW", "RESOLVED"]),
});

export const respondToIssueSchema = z.object({
  message: z.string().min(3, "Response is too short"),
});

// ── Review moderation ──
export const removeReviewSchema = z.object({
  reason: z.string().min(3, "Please provide a reason"),
});

// ── Refunds oversight ──
export const adminDeclineRefundSchema = z.object({
  reason: z.string().min(3, "Please provide a reason").optional(),
});

// ── User management ──
export const suspendUserSchema = z.object({
  reason: z.string().min(3, "Please provide a reason").optional(),
});

// ── Categories ──
export const toggleCategoryActiveSchema = z.object({
  isActive: z.boolean(),
});

// ── Badges ──
export const createBadgeSchema = z.object({
  name: z.string().min(2),
  icon: z.string().min(1),
  description: z.string().optional(),
  xpReward: z.number().int().nonnegative().default(0),
  perks: z.array(z.string()).default([]),
});

export const updateBadgeSchema = createBadgeSchema.partial();

export const createBadgeRequirementSchema = z.object({
  label: z.string().min(2),
  total: z.number().int().positive().optional(),
});

export const updateBadgeRequirementSchema = createBadgeRequirementSchema.partial();

// ── Help center ──
export const createHelpCategorySchema = z.object({
  role: z.enum(["user", "vendor", "rider"]),
  label: z.string().min(2),
  icon: z.string().optional(),
  bg: z.string().optional(),
  subtitle: z.string().optional(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const updateHelpCategorySchema = createHelpCategorySchema.partial();

export const createHelpArticleSchema = z.object({
  articleId: z.string().min(1),
  categoryId: z.string().uuid(),
  role: z.enum(["user", "vendor", "rider"]),
  title: z.string().min(2),
  sub: z.string().optional(),
  popular: z.boolean().default(false),
  sections: z.array(z.object({ heading: z.string(), body: z.string() })),
});

export const updateHelpArticleSchema = createHelpArticleSchema.partial();

// ── Legal documents ──
export const legalSectionSchema = z.object({
  heading: z.string(),
  body: z.string(),
});

export const createLegalDocSchema = z.object({
  slug: z.string().min(2),
  role: z.enum(["user", "vendor", "rider", "all"]),
  lastUpdated: z.string().min(1),
  intro: z.string().min(1),
  sections: z.array(legalSectionSchema),
});

export const publishLegalDocVersionSchema = z.object({
  lastUpdated: z.string().min(1),
  intro: z.string().min(1),
  sections: z.array(legalSectionSchema),
});

// ── Admin — promotions (admin creates/edits on behalf of a chosen vendor) ──
export const adminCreatePromotionSchema = z
  .object({
    vendorId: z.string().uuid(),
    title: z.string().min(3, "Title must be at least 3 characters"),
    subtitle: z.string().optional(),
    type: z.string().min(2, "Invalid promotion type"),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    description: z.string().optional(),
    discountValue: z.number().nonnegative().optional().default(0),
    promoCode: z.string().optional(),
    minimumOrder: z.number().nonnegative().optional().default(0),
    maxUses: z.number().int().positive().optional(),
    appliesTo: z.enum(["all", "specific"]),
    productIds: z.array(z.string().uuid()).optional().default([]),
  })
  .refine((data) => data.endDate > data.startDate, {
    message: "End date must be after start date",
    path: ["endDate"],
  });

export const adminUpdatePromotionSchema = z
  .object({
    title: z.string().min(3).optional(),
    subtitle: z.string().optional(),
    isActive: z.boolean().optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    description: z.string().optional(),
    discountValue: z.number().nonnegative().optional(),
    promoCode: z.string().optional(),
    minimumOrder: z.number().nonnegative().optional(),
    maxUses: z.number().int().positive().optional(),
    appliesTo: z.enum(["all", "specific"]).optional(),
    productIds: z.array(z.string().uuid()).optional(),
  })
  .refine(
    (data) =>
      !data.startDate || !data.endDate || data.endDate > data.startDate,
    {
      message: "End date must be after start date",
      path: ["endDate"],
    },
  );

// ── Admin — bulk email ──
export const sendEmailSchema = z
  .object({
    subject: z.string().min(3, "Subject is too short"),
    message: z.string().min(3, "Message is too short"),
    recipientId: z.string().uuid().optional(),
    roles: z.array(z.enum(["user", "vendor", "rider"])).optional(),
  })
  .refine((d) => !!d.recipientId || (d.roles && d.roles.length > 0), {
    message: "Specify a recipientId or at least one role.",
    path: ["roles"],
  });
