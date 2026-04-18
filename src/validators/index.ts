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
    .regex(/^\+?[0-9]+$/, "Invalid phone number"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(
      /[!@#$%^&*(),.?":{}|<>]/,
      "Password must contain at least one special character",
    ),
  role: z.enum(["user", "vendor", "rider"]),
});

export const signInSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(1, "Password is required"),
});

export const verifyEmailSchema = z.object({
  code: z.string().length(6, "Code must be 6 digits"),
  purpose: z.enum(["verify-account", "reset-password"]),
  role: z.enum(["user", "vendor", "rider"]).optional(),
  email: z.string().email().optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email"),
  purpose: z.string().min(1, "Purpose is required"),
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
    userId: z.string().uuid().optional(), // Used in forgot-password flow
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
  purpose: z.string().min(1, "Purpose is required"),
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
});

export const updateCartItemSchema = z.object({
  qty: z.number().int().min(0).max(20),
});

export const checkoutSchema = z.object({
  savedLocationId: z.string().uuid("Please select a valid delivery location"),
  paymentMethod: z.enum(["card", "bank_transfer"]),
  instructions: z.string().max(200, "Instructions too long").optional(),
  contactMethod: z.enum(["in-app", "normal"]).default("in-app"),
});

// ─────────────────────────────────────────────────────────────────────────────
// Orders
// ─────────────────────────────────────────────────────────────────────────────

export const cancelOrderSchema = z.object({
  reason: z.string().min(5, "Please provide a cancellation reason"),
});

export const reviewSchema = z.object({
  restaurantRating: z.number().int().min(1).max(5),
  foodRating: z.number().int().min(1).max(5),
  riderRating: z.number().int().min(1).max(5),
  tags: z.array(z.string()).optional().default([]),
  comment: z.string().max(500).optional(),
  proofUrls: z.array(z.string().url()).optional().default([]),
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

// ─────────────────────────────────────────────────────────────────────────────
// Vendor — promotion
// ─────────────────────────────────────────────────────────────────────────────

export const createPromotionSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters"),
  subtitle: z.string().optional(),
  type: z.string().min(2, "Invalid promotion type"),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  description: z.string().optional(),
  discountValue: z.number().nonnegative().optional().default(0),
  promoCode: z.string().optional(),
  minimumOrder: z.number().nonnegative().optional().default(0),
  // Added fields to match implementation
  appliesTo: z.enum(["all", "specific"]),
  productIds: z.array(z.string().uuid()).optional().default([]),
});

export const updatePromotionSchema = z.object({
  title: z.string().min(3).optional(),
  subtitle: z.string().optional(),
  isActive: z.boolean().optional(),
  endDate: z.coerce.date().optional(),
  description: z.string().optional(),
  discountValue: z.number().nonnegative().optional(),
  promoCode: z.string().optional(),
  minimumOrder: z.number().nonnegative().optional(),
  // Added fields for editing product scope
  appliesTo: z.enum(["all", "specific"]).optional(),
  productIds: z.array(z.string().uuid()).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Vendor — payout
// ─────────────────────────────────────────────────────────────────────────────

export const saveBankSchema = z.object({
  bank: z.string().min(2),
  name: z.string().min(2),
  accountNumber: z.string().min(10).max(10),
  bankCode: z.string().optional(),
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
});

export const riderSaveBankSchema = z.object({
  bank: z.string().min(2),
  name: z.string().min(2),
  accountNumber: z.string().length(10, "Account number must be 10 digits"),
  bankCode: z.string().optional(),
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
