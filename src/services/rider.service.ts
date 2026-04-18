// src/services/rider.service.ts
import bcrypt from "bcryptjs";
import { prisma } from "../config/database";
import { AppError } from "../utils/AppError";
import {
  buildMeta,
  maskAccountNumber,
  parsePagination,
  haversineKm,
  estimateEtaMinutes,
  formatDistance,
} from "../utils";
import { PaginationQuery } from "../types";
import { cfg } from "./config.service";
import * as notif from "../events/notification.events";
import { sendOtpEmail } from "@/utils/email";

// ─────────────────────────────────────────────────────────────────────────────
// OTP helpers
// ─────────────────────────────────────────────────────────────────────────────

const genOtp = () =>
  Array.from({ length: 3 }, () => Math.floor(Math.random() * 10)).join(" "); // e.g. "4 2 9"

// ─────────────────────────────────────────────────────────────────────────────
// Profile
// ─────────────────────────────────────────────────────────────────────────────

export const getRiderProfile = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      accountId: true,
      fullName: true,
      email: true,
      phone: true,
      imageUrl: true,
      joinedDate: true,
      riderProfile: true,
      profileCompletion: true,
    },
  });
  if (!user) throw AppError.notFound("User");
  return user;
};

export const updateRiderProfile = async (
  userId: string,
  data: {
    fullName?: string;
    phone?: string;
    imageUrl?: string;
    vehicleType?: string;
    vehiclePlate?: string;
  },
) => {
  const { fullName, phone, imageUrl, ...riderData } = data;

  const userFields = {
    ...(fullName && { fullName }),
    ...(phone && { phone }),
    ...(imageUrl && { imageUrl }),
  };

  const riderFields = {
    ...(riderData.vehicleType && { vehicleType: riderData.vehicleType }),
    ...(riderData.vehiclePlate && { vehiclePlate: riderData.vehiclePlate }),
  };

  const ops: any[] = [];

  if (Object.keys(userFields).length > 0) {
    ops.push(
      prisma.user.update({
        where: { id: userId },
        data: userFields,
        select: { id: true, fullName: true, phone: true, imageUrl: true },
      }),
    );
  }

  if (Object.keys(riderFields).length > 0) {
    ops.push(
      prisma.riderProfile.update({
        where: { userId },
        data: riderFields,
      }),
    );
  }

  if (ops.length === 0) return {};

  const results = await prisma.$transaction(ops);
  return results[0];
};

export const changeRiderPassword = async (
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw AppError.notFound("User");
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) throw AppError.badRequest("Current password is incorrect.");
  const hash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: hash },
  });
};

export const deleteRiderAccount = async (userId: string): Promise<void> => {
  await prisma.user.update({
    where: { id: userId },
    data: { isActive: false, email: `deleted_rider_${userId}@rave.com` },
  });
};

export const toggleOnlineStatus = async (
  userId: string,
  isOnline: boolean,
): Promise<{ isOnline: boolean }> => {
  const rider = await _requireRider(userId);
  await prisma.riderProfile.update({
    where: { id: rider.id },
    data: { isOnline },
  });
  return { isOnline };
};

export const getRiderOnboardingState = async (userId: string) => {
  const rider = await _requireRider(userId);
  const user = await prisma.user.findUnique({ where: { id: userId } });

  const bank = rider.bankAccounts[0] || null;

  // Determine which steps are done based on data presence
  const step0Done = !!(
    rider.currentAddress &&
    rider.stateOfResidence &&
    rider.cityOfResidence
  ); // Address
  const step1Done = !!(rider.currentLat && rider.currentLng); // Location
  const step2Done = !!(
    rider.vehiclePlate &&
    rider.bikeDocUrl &&
    rider.vehicleType &&
    rider.bikeVerificationType
  ); // Bike
  const step3Done = !!(
    rider.idDocUrl &&
    rider.selfieUrl &&
    rider.residenceType &&
    rider.residenceDocUrl
  ); // Identity
  const step4Done = !!bank; // Bank

  let resumeStep = 0;
  if (!step0Done) resumeStep = 0;
  else if (!step1Done) resumeStep = 1;
  else if (!step2Done) resumeStep = 2;
  else if (!step3Done) resumeStep = 3;
  else if (!step4Done) resumeStep = 4;
  else resumeStep = 5; // Review

  return {
    resumeStep,
    setupProgress: rider.setupProgress,
    stateOfResidence: rider.stateOfResidence || null,
    cityOfResidence: rider.cityOfResidence || null,
    currentAddress: rider.currentAddress,
    currentLat: rider.currentLat,
    currentLng: rider.currentLng,
    vehicleType: rider.vehicleType,
    vehiclePlate: rider.vehiclePlate,
    bikeVerificationType: rider.bikeVerificationType || null,
    bikeDocUrl: rider.bikeDocUrl || null,
    plateImageUrl: rider.plateImageUrl || null,
    identityType: rider.identityType || null,
    idDocUrl: rider.idDocUrl || null,
    selfieUrl: rider.selfieUrl || null,
    residenceType: rider.residenceType || null,
    residenceDocUrl: rider.residenceDocUrl || null,
    bank: bank
      ? {
          bank: bank.bankName,
          accountNumber: bank.accountNumber,
          name: bank.accountName,
        }
      : null,
  };
};

export const saveRiderOnboardingStep = async (
  userId: string,
  step: number,
  data: any,
) => {
  const rider = await _requireRider(userId);

  // --- Step 0: Residence Details ---
  if (step === 0) {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { location: data.homeAddress },
      }),
      prisma.riderProfile.update({
        where: { id: rider.id },
        data: {
          stateOfResidence: data.stateOfResidence,
          cityOfResidence: data.cityOfResidence,
          currentAddress: data.currentAddress,
        },
      }),
    ]);
  }
  // --- Step 1: Live Location (Address + Coords) ---
  else if (step === 1) {
    await prisma.riderProfile.update({
      where: { id: rider.id },
      data: {
        currentAddress: data.currentAddress,
        currentLat: data.currentLat,
        currentLng: data.currentLng,
      },
    });
  }
  // --- Step 2: Bike Details ---
  else if (step === 2) {
    await prisma.riderProfile.update({
      where: { id: rider.id },
      data: {
        bikeVerificationType: data.bikeVerificationType,
        bikeDocUrl: data.bikeDocUrl,
        plateImageUrl: data.plateImageUrl,
        vehiclePlate: data.vehiclePlate,
      },
    });
  }
  // --- Step 3: Identity Verification ---
  else if (step === 3) {
    await prisma.riderProfile.update({
      where: { id: rider.id },
      data: {
        identityType: data.identityType,
        idDocUrl: data.idDocUrl,
        selfieUrl: data.selfieUrl,
        residenceType: data.residenceType,
        residenceDocUrl: data.residenceDocUrl,
      },
    });
  }
  // --- Step 4: Bank Account (Payout) ---
  else if (step === 4) {
    // Note: data is { bank: { bank, accountNumber, name, bankCode } }
    const bankInfo = data.bank;

    await prisma.bankAccount.upsert({
      where: {
        // Find existing primary bank or use dummy ID for creation
        id: rider.bankAccounts.find((b) => b.isPrimary)?.id || "new-id",
      },
      create: {
        riderId: rider.id,
        bankName: bankInfo.bank,
        accountName: bankInfo.name,
        accountNumber: bankInfo.accountNumber,
        isPrimary: true,
        bankCode: bankInfo.bankCode,
      },
      update: {
        bankName: bankInfo.bank,
        accountName: bankInfo.name,
        accountNumber: bankInfo.accountNumber,
        bankCode: bankInfo.bankCode,
      },
    });
  }

  // --- Recalculate Progress ---
  const state = await getRiderOnboardingState(userId);
  const progressSteps = [
    !!state.currentAddress, // Step 0
    !!state.currentLat, // Step 1
    !!state.vehiclePlate, // Step 2
    !!state.idDocUrl, // Step 3
    !!state.bank, // Step 4
  ];

  const setupProgress = Math.round(
    (progressSteps.filter(Boolean).length / 5) * 100,
  );

  await prisma.riderProfile.update({
    where: { id: rider.id },
    data: { setupProgress },
  });

  return { setupProgress };
};

export const submitRiderOnboarding = async (userId: string) => {
  const rider = await _requireRider(userId);

  if (rider.setupProgress < 100) {
    throw AppError.badRequest("Please complete all steps before submitting.");
  }

  await prisma.riderProfile.update({
    where: { id: rider.id },
    data: { status: "pending" },
  });

  return { success: true };
};

// ─────────────────────────────────────────────────────────────────────────────
// Location — real-time position updates
// ─────────────────────────────────────────────────────────────────────────────

export const updateLocation = async (
  userId: string,
  lat: number,
  lng: number,
  address?: string,
): Promise<void> => {
  const rider = await _requireRider(userId);

  await prisma.$transaction([
    prisma.riderProfile.update({
      where: { id: rider.id },
      data: { currentLat: lat, currentLng: lng, currentAddress: address },
    }),
    prisma.riderLocationLog.create({
      data: { riderId: rider.id, lat, lng },
    }),
  ]);
};

export const getSavedLocation = async (userId: string) => {
  const rider = await _requireRider(userId);
  if (!rider.currentLat || !rider.currentLng) return null;
  return {
    lat: rider.currentLat,
    lng: rider.currentLng,
    address: rider.currentAddress ?? "",
  };
};

export const saveLocation = async (
  userId: string,
  lat: number,
  lng: number,
  address: string,
): Promise<{ address: string }> => {
  await updateLocation(userId, lat, lng, address);
  return { address };
};

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard — available orders near the rider
// ─────────────────────────────────────────────────────────────────────────────

export const getDashboardStats = async (userId: string) => {
  const rider = await _requireRider(userId);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [todayDeliveries, todayEarningsTx] = await Promise.all([
    prisma.delivery.count({
      where: {
        riderId: rider.id,
        status: "delivered",
        deliveredAt: { gte: today },
      },
    }),
    prisma.transaction.aggregate({
      where: { riderId: rider.id, type: "payment", createdAt: { gte: today } },
      _sum: { amount: true },
    }),
  ]);

  return {
    todayEarnings: todayEarningsTx._sum.amount ?? 0,
    completedDeliveries: todayDeliveries,
    onlineTime: "0h 0m", // implement with session tracking if needed
    isOnline: rider.isOnline,
  };
};

export const getAvailableOrders = async (userId: string) => {
  const rider = await _requireRider(userId);

  if (!rider.currentLat || !rider.currentLng) {
    throw AppError.badRequest(
      "Please enable location sharing to see available orders near you.",
    );
  }

  // Orders that are "ready" and have no assigned rider yet
  const orders = await prisma.order.findMany({
    where: {
      status: "ready",
      delivery: null,
    },
    include: {
      vendor: {
        select: {
          storeName: true,
          logoUrl: true,
          address: true,
          lat: true,
          lng: true,
        },
      },
      items: { select: { name: true, qty: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  return orders.map((o) => {
    // Distance from rider to vendor (pickup leg)
    const distanceKm =
      rider.currentLat && rider.currentLng && o.vendor.lat && o.vendor.lng
        ? haversineKm(
            rider.currentLat,
            rider.currentLng,
            o.vendor.lat,
            o.vendor.lng,
          )
        : null;

    return {
      id: o.id,
      orderNumber: o.orderId,
      storeName: o.vendor.storeName,
      storeImage: o.vendor.logoUrl,
      price: o.deliveryFee,
      pickupAddress: o.vendor.address ?? "",
      deliveryAddress: o.deliveryAddress,
      vendorLat: o.vendor.lat ?? null,
      vendorLng: o.vendor.lng ?? null,
      userLat: o.deliveryLat ?? null,
      userLng: o.deliveryLng ?? null,
      distanceKm: distanceKm != null ? Math.round(distanceKm * 10) / 10 : null,
      distanceLabel: distanceKm != null ? formatDistance(distanceKm) : null,
      estimatedMinutes:
        distanceKm != null ? estimateEtaMinutes(distanceKm) : 15,
      status: "available" as const,
      items: o.items,
    };
  });
};

export const acceptOrder = async (
  userId: string,
  orderId: string,
): Promise<{ success: boolean }> => {
  // 1. Require and validate Rider
  const rider = await prisma.riderProfile.findUnique({
    where: { userId },
  });

  if (!rider) throw AppError.notFound("Rider profile not found.");
  if (!rider.isOnline)
    throw AppError.badRequest("You must be online to accept orders.");
  // if (rider.status !== "verified")
  //   throw AppError.forbidden(
  //     "Your account is not yet verified for deliveries.",
  //   );

  // 2. Fetch Order with User and Vendor User (for emails)
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      delivery: true,
      user: { select: { id: true, fullName: true, email: true } },
      vendor: {
        include: {
          user: { select: { fullName: true, email: true } }, // Vendor's User record
        },
      },
    },
  });

  if (!order) throw AppError.notFound("Order");
  if (order.delivery)
    throw AppError.conflict("This order has already been accepted.");
  if (order.status !== "ready")
    throw AppError.badRequest("Order is not ready for pickup.");

  // 3. Fetch Rider User details for Order update
  const riderUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { fullName: true, phone: true },
  });

  // 4. Distance and ETA Calculation
  let distanceKm = 2.5;
  let etaMinutes = 15;

  if (
    rider.currentLat &&
    rider.currentLng &&
    order.vendor.lat &&
    order.vendor.lng
  ) {
    distanceKm =
      Math.round(
        haversineKm(
          rider.currentLat,
          rider.currentLng,
          order.vendor.lat,
          order.vendor.lng,
        ) * 10,
      ) / 10;
    etaMinutes = estimateEtaMinutes(distanceKm);
  }

  // 5. Generate Security OTPs
  const vendorOtp = genOtp(); // To be verified at Pickup
  const customerOtp = genOtp(); // To be verified at Delivery

  // 6. Send OTPs via Email
  // To Customer
  if (order.user.email) {
    await sendOtpEmail(
      order.user.email,
      order.user.fullName,
      customerOtp,
      "order-delivery-code",
    );
  }

  // To Vendor (Using vendor.user.email)
  if (order.vendor.user.email) {
    await sendOtpEmail(
      order.vendor.user.email,
      order.vendor.user.fullName,
      vendorOtp,
      "vendor-pickup-code",
    );
  }

  // 7. Atomic Transaction: Create Delivery & Update Order
  await prisma.$transaction([
    prisma.delivery.create({
      data: {
        orderId: order.id,
        riderId: rider.id,
        status: "ongoing", // Transition to ongoing immediately upon acceptance
        vendorOtp,
        customerOtp,
        estimatedPickupTime: new Date(
          Date.now() + etaMinutes * 60_000,
        ).toISOString(),
        distanceKm,
        etaMinutes,
        acceptedAt: new Date(),
      },
    }),
    prisma.order.update({
      where: { id: orderId },
      data: {
        status: "ongoing",
        // Using fields matching common Order patterns (Add these to Order model if missing)
        // riderName: riderUser?.fullName,
        // riderPhone: riderUser?.phone,
      },
    }),
  ]);

  // 8. Notifications
  try {
    await Promise.all([
      notif.notifyRiderAssigned(
        order.user.id,
        orderId,
        riderUser?.fullName ?? "Your rider",
      ),
      notif.notifyRiderDeliveryAccepted(
        userId,
        orderId,
        order.vendor.storeName,
      ),
    ]);
  } catch (err) {
    console.error("Notification failed but transaction succeeded:", err);
  }

  return { success: true };
};

// ─────────────────────────────────────────────────────────────────────────────
// Deliveries
// ─────────────────────────────────────────────────────────────────────────────

export const getOngoingDeliveries = async (userId: string) => {
  const rider = await _requireRider(userId);

  const deliveries = await prisma.delivery.findMany({
    where: {
      riderId: rider.id,
      status: { in: ["not_accepted", "pending", "ongoing"] },
    },
    include: {
      order: {
        include: {
          vendor: {
            select: {
              storeName: true,
              logoUrl: true,
              address: true,
              user: { select: { phone: true } },
            },
          },
          user: { select: { fullName: true, phone: true } },
          items: { select: { name: true, qty: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return deliveries.map(_formatDelivery);
};

export const getPastDeliveries = async (
  userId: string,
  query: PaginationQuery & {
    status?: string;
    startDate?: string;
    endDate?: string;
  },
) => {
  const rider = await _requireRider(userId);
  const { page, limit, skip } = parsePagination(query);

  const statusFilter =
    query.status && query.status !== "all"
      ? [query.status]
      : ["delivered", "cancelled"];

  const where: any = {
    riderId: rider.id,
    status: { in: statusFilter },
    ...(query.startDate || query.endDate
      ? {
          createdAt: {
            ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
            ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
          },
        }
      : {}),
  };

  const [deliveries, total] = await Promise.all([
    prisma.delivery.findMany({
      where,
      include: {
        order: {
          include: {
            vendor: {
              select: {
                storeName: true,
                logoUrl: true,
                address: true,
                user: { select: { phone: true } },
              },
            },
            user: { select: { fullName: true, phone: true } },
            items: { select: { name: true, qty: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.delivery.count({ where }),
  ]);

  // Group by date label for the current page
  const grouped: Record<string, ReturnType<typeof _formatDelivery>[]> = {};
  for (const d of deliveries) {
    const label = _dateLabel(d.createdAt);
    if (!grouped[label]) grouped[label] = [];
    grouped[label].push(_formatDelivery(d));
  }

  return { grouped, meta: buildMeta(total, page, limit) };
};

export const getDeliveryDetail = async (userId: string, deliveryId: string) => {
  const rider = await _requireRider(userId);

  const delivery = await prisma.delivery.findFirst({
    where: { id: deliveryId, riderId: rider.id },
    include: {
      order: {
        include: {
          vendor: {
            include: { user: { select: { phone: true } } },
          },
          user: { select: { fullName: true, phone: true } },
          items: {
            select: {
              name: true,
              qty: true,
              price: true,
              menuItem: { select: { images: true } },
            },
          },
        },
      },
    },
  });

  if (!delivery) throw AppError.notFound("Delivery");

  const order = delivery.order;
  const vendor = order.vendor;

  return {
    id: delivery.id,
    orderNumber: order.orderId,
    status: delivery.status,
    estimatedTime: `${delivery.etaMinutes ?? 15} mins`,
    deliveryNote: order.deliveryInstructions,
    contactMethod: order.contactMethod ?? "in-app",
    vendor: {
      name: vendor.storeName,
      avatarUrl: vendor.logoUrl,
      phone: vendor.user?.phone ?? "",
      address: vendor.address ?? "",
      details: "",
      lat: vendor.lat ?? null,
      lng: vendor.lng ?? null,
    },
    customer: {
      name: order.user.fullName,
      avatarUrl: null,
      phone: order.user.phone,
      address: order.deliveryAddress,
      details: order.deliveryInstructions ?? "",
      lat: order.deliveryLat ?? null,
      lng: order.deliveryLng ?? null,
    },
    vendorOtp: delivery.vendorOtp,
    customerOtp: delivery.customerOtp,
    vendorOtpVerified: delivery.vendorOtpVerified,
    customerOtpVerified: delivery.customerOtpVerified,
    packageSummary: order.items.map((i) => ({
      name: i.name,
      quantity: i.qty,
      images: i.menuItem?.images ?? null,
    })),
    earnings: delivery.earnings,
  };
};

export const updateDeliveryStatus = async (
  userId: string,
  deliveryId: string,
  newStatus: "pending" | "ongoing" | "delivered" | "cancelled",
): Promise<{ success: boolean; newStatus: string }> => {
  const rider = await _requireRider(userId);

  const delivery = await prisma.delivery.findFirst({
    where: { id: deliveryId, riderId: rider.id },
    include: { order: true },
  });
  if (!delivery) throw AppError.notFound("Delivery");

  const orderStatusMap: Record<string, "ongoing" | "completed" | "cancelled"> =
    {
      pending: "ongoing",
      ongoing: "ongoing",
      delivered: "completed",
      cancelled: "cancelled",
    };

  const commission = await cfg.fees.vendorCommission();
  const earnings =
    newStatus === "delivered"
      ? delivery.order.deliveryFee * (1 - commission)
      : undefined;

  await prisma.$transaction(async (tx) => {
    await tx.delivery.update({
      where: { id: deliveryId },
      data: {
        status: newStatus,
        ...(newStatus === "ongoing" ? { pickedUpAt: new Date() } : {}),
        ...(newStatus === "delivered"
          ? { deliveredAt: new Date(), earnings }
          : {}),
        ...(newStatus === "cancelled" ? { cancelledAt: new Date() } : {}),
      },
    });

    await tx.order.update({
      where: { id: delivery.orderId },
      data: { status: orderStatusMap[newStatus] },
    });

    if (newStatus === "delivered" && earnings) {
      await tx.riderProfile.update({
        where: { id: rider.id },
        data: {
          totalDeliveries: { increment: 1 },
          totalEarnings: { increment: earnings },
        },
      });
    }
  });

  if (newStatus === "delivered") {
    await notif.notifyOrderDelivered(delivery.order.userId, delivery.orderId);
  }

  if (newStatus === "cancelled") {
    await notif.notifyOrderCancelled(
      delivery.order.userId,
      delivery.orderId,
      "store",
    );
  }

  return { success: true, newStatus };
};

export const verifyVendorOtp = async (
  userId: string,
  deliveryId: string,
  otp: string,
): Promise<{ success: boolean }> => {
  const rider = await _requireRider(userId);

  const delivery = await prisma.delivery.findFirst({
    where: { id: deliveryId, riderId: rider.id },
  });
  if (!delivery) throw AppError.notFound("Delivery");

  // Compare ignoring spaces
  const stored = delivery.vendorOtp?.replace(/ /g, "") ?? "";
  const given = otp.replace(/ /g, "");

  if (stored !== given) throw AppError.badRequest("Invalid OTP code.");

  await prisma.delivery.update({
    where: { id: deliveryId },
    data: { vendorOtpVerified: true },
  });

  return { success: true };
};

export const verifyCustomerOtp = async (
  userId: string,
  deliveryId: string,
  otp: string,
): Promise<{ success: boolean }> => {
  const rider = await _requireRider(userId);

  const delivery = await prisma.delivery.findFirst({
    where: { id: deliveryId, riderId: rider.id },
  });
  if (!delivery) throw AppError.notFound("Delivery");

  const stored = delivery.customerOtp?.replace(/ /g, "") ?? "";
  const given = otp.replace(/ /g, "");

  if (stored !== given) throw AppError.badRequest("Invalid OTP code.");

  await prisma.delivery.update({
    where: { id: deliveryId },
    data: { customerOtpVerified: true },
  });

  return { success: true };
};

export const resendOtp = async (
  _userId: string,
  _deliveryId: string,
  _party: "vendor" | "customer",
): Promise<{ success: boolean }> => {
  // In production: resend via SMS/push
  return { success: true };
};

export const uploadPickupProof = async (
  userId: string,
  deliveryId: string,
  fileUrl: string,
): Promise<{ success: boolean }> => {
  const rider = await _requireRider(userId);
  const delivery = await prisma.delivery.findFirst({
    where: { id: deliveryId, riderId: rider.id },
  });
  if (!delivery) throw AppError.notFound("Delivery");

  await prisma.delivery.update({
    where: { id: deliveryId },
    data: { pickupProofUrl: fileUrl },
  });
  return { success: true };
};

export const uploadDeliveryProof = async (
  userId: string,
  deliveryId: string,
  fileUrl: string,
): Promise<{ success: boolean }> => {
  const rider = await _requireRider(userId);

  // 1. Fetch delivery to ensure ownership and get the associated orderId
  const delivery = await prisma.delivery.findFirst({
    where: { id: deliveryId, riderId: rider.id },
    select: { id: true, orderId: true, status: true },
  });

  if (!delivery) throw AppError.notFound("Delivery");

  // Prevent double-processing if already delivered
  if (delivery.status === "delivered") {
    return { success: true };
  }

  // 2. Atomic Transaction: Update Delivery and Order status
  await prisma.$transaction([
    // Update Delivery record
    prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        deliveryProofUrl: fileUrl,
        status: "delivered",
        deliveredAt: new Date(),
      },
    }),
    // Update main Order record
    prisma.order.update({
      where: { id: delivery.orderId },
      data: {
        status: "completed",
      },
    }),
    // Optional: Increment rider's total delivery count
    prisma.riderProfile.update({
      where: { id: rider.id },
      data: { totalDeliveries: { increment: 1 } },
    }),
  ]);

  return { success: true };
};

export const submitDeliveryIssue = async (
  userId: string,
  deliveryId: string,
  data: { issues: string[]; note: string },
): Promise<{ success: boolean }> => {
  const rider = await _requireRider(userId);
  const delivery = await prisma.delivery.findFirst({
    where: { id: deliveryId, riderId: rider.id },
    include: { order: true },
  });
  if (!delivery) throw AppError.notFound("Delivery");

  await prisma.reportedIssue.create({
    data: {
      userId,
      role: "rider" as any,
      title: `Delivery Issue — ${delivery.order.orderId}`,
      category: data.issues[0] ?? "other",
      description: `Issues: ${data.issues.join(", ")}. Note: ${data.note}`,
      status: "OPEN",
    },
  });

  return { success: true };
};

// ─────────────────────────────────────────────────────────────────────────────
// Analytics
// ─────────────────────────────────────────────────────────────────────────────

export const getAnalytics = async (userId: string) => {
  const rider = await _requireRider(userId);

  const [totalTx, totalDeliveries, completedDeliveries, cancelledDeliveries] =
    await Promise.all([
      prisma.transaction.aggregate({
        where: { riderId: rider.id, type: "payment" },
        _sum: { amount: true },
        _avg: { amount: true },
      }),
      prisma.delivery.count({ where: { riderId: rider.id } }),
      prisma.delivery.count({
        where: { riderId: rider.id, status: "delivered" },
      }),
      prisma.delivery.count({
        where: { riderId: rider.id, status: "cancelled" },
      }),
    ]);

  const totalRevenue = totalTx._sum.amount ?? 0;
  const averageOrderValue = Math.round(totalTx._avg.amount ?? 0);

  return {
    totalRevenue,
    revenueGrowth: 18,
    pendingEarnings: 0,
    pendingHoursLeft: 0,
    averageOrderValue,
    totalOrders: totalDeliveries,
    ordersGrowth: 22,
    completedOrders: completedDeliveries,
    completionRate:
      totalDeliveries > 0
        ? Math.round((completedDeliveries / totalDeliveries) * 100)
        : 0,
    cancelledOrders: cancelledDeliveries,
    cancellationRate:
      totalDeliveries > 0
        ? Math.round((cancelledDeliveries / totalDeliveries) * 100)
        : 0,
    declinedOrders: 0,
    declinedRate: 0,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Reviews (rider-facing — reviews customers leave for the rider)
// ─────────────────────────────────────────────────────────────────────────────

export const getRiderRatingStats = async (userId: string) => {
  const rider = await _requireRider(userId);

  const reviews = await prisma.review.findMany({
    where: {
      order: { delivery: { riderId: rider.id } },
    },
    select: { riderRating: true },
  });

  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;

  for (const r of reviews) {
    distribution[r.riderRating] = (distribution[r.riderRating] ?? 0) + 1;
    total += r.riderRating;
  }

  return {
    averageRating:
      reviews.length > 0 ? parseFloat((total / reviews.length).toFixed(1)) : 0,
    totalReviews: reviews.length,
    distribution,
  };
};

export const getRiderReviews = async (
  userId: string,
  query: PaginationQuery,
) => {
  const rider = await _requireRider(userId);
  const { page, limit, skip } = parsePagination(query);

  const [reviews, total] = await Promise.all([
    prisma.review.findMany({
      where: { order: { delivery: { riderId: rider.id } } },
      include: {
        user: { select: { fullName: true, imageUrl: true } },
        order: {
          select: {
            orderId: true,
            items: { select: { name: true }, take: 1 },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.review.count({
      where: { order: { delivery: { riderId: rider.id } } },
    }),
  ]);

  return {
    reviews: reviews.map((r) => ({
      id: r.id,
      customerName: r.user.fullName,
      customerImage: r.user.imageUrl,
      rating: r.riderRating,
      comment: r.comment,
      date: r.createdAt.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
      createdAt: r.createdAt.toISOString(),
      verified: r.isVerified,
      orderItem: r.order.items[0]?.name,
      orderDate: r.order.orderId,
    })),
    meta: buildMeta(total, page, limit),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Earnings / Transactions
// ─────────────────────────────────────────────────────────────────────────────
export const getTransactions = async (
  userId: string,
  query: PaginationQuery & { type?: string },
) => {
  const rider = await _requireRider(userId);
  const { page, limit, skip } = parsePagination(query);

  const validTypes = ["payment", "withdrawal"];
  const typeFilter =
    query.type && query.type !== "all" && validTypes.includes(query.type)
      ? (query.type as any)
      : undefined;

  const where = {
    riderId: rider.id,
    ...(typeFilter ? { type: typeFilter } : {}),
  };

  const [txs, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.transaction.count({ where }),
  ]);

  return {
    transactions: txs.map(_formatTx),
    meta: buildMeta(total, page, limit),
  };
};

export const getTransactionById = async (userId: string, txId: string) => {
  const rider = await _requireRider(userId);
  const tx = await prisma.transaction.findFirst({
    where: { id: txId, riderId: rider.id },
  });
  if (!tx) throw AppError.notFound("Transaction");
  return _formatTx(tx);
};

// ─────────────────────────────────────────────────────────────────────────────
// Bank accounts
// ─────────────────────────────────────────────────────────────────────────────

export const getBankAccounts = async (userId: string) => {
  const rider = await _requireRider(userId);
  const accounts = await prisma.bankAccount.findMany({
    where: { riderId: rider.id },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  return accounts.map((a) => ({
    ...a,
    maskedNumber: maskAccountNumber(a.accountNumber),
  }));
};

export const saveBankAccount = async (
  userId: string,
  data: {
    bankName: string;
    accountName: string;
    accountNumber: string;
    bankCode: string;
  },
): Promise<void> => {
  const rider = await _requireRider(userId);
  const count = await prisma.bankAccount.count({
    where: { riderId: rider.id },
  });
  await prisma.bankAccount.create({
    data: { riderId: rider.id, isPrimary: count === 0, ...data },
  });
};

export const setPrimaryBank = async (
  userId: string,
  bankId: string,
): Promise<void> => {
  const rider = await _requireRider(userId);
  await prisma.$transaction([
    prisma.bankAccount.updateMany({
      where: { riderId: rider.id },
      data: { isPrimary: false },
    }),
    prisma.bankAccount.update({
      where: { id: bankId },
      data: { isPrimary: true },
    }),
  ]);
};

export const deleteBankAccount = async (
  userId: string,
  bankId: string,
): Promise<void> => {
  const rider = await _requireRider(userId);
  const account = await prisma.bankAccount.findFirst({
    where: { id: bankId, riderId: rider.id },
  });
  if (!account) throw AppError.notFound("Bank account");
  await prisma.bankAccount.delete({ where: { id: bankId } });
};

// ─────────────────────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────────────────────

export const getNotifications = async (
  userId: string,
  query: { cursor?: string; type?: string; limit?: string },
) => {
  const take = Math.min(Number(query.limit) || 20, 50);

  const validTypes = ["order", "rider", "payment", "promo", "wallet"];
  const typeFilter =
    query.type && query.type !== "all" && validTypes.includes(query.type)
      ? (query.type as any)
      : undefined;

  const where = {
    userId,
    ...(typeFilter ? { type: typeFilter } : {}),
  };

  const notifications = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: take + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  const hasMore = notifications.length > take;
  const items = hasMore ? notifications.slice(0, take) : notifications;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return { notifications: items, hasMore, nextCursor };
};

export const markAllNotificationsRead = (userId: string) =>
  prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });

export const deleteNotification = (userId: string, id: string) =>
  prisma.notification.deleteMany({ where: { id, userId } });

export const getNotificationSettings = async (userId: string) => {
  let settings = await prisma.notificationSettings.findUnique({
    where: { userId },
  });
  if (!settings)
    settings = await prisma.notificationSettings.create({ data: { userId } });
  return settings;
};

export const updateNotificationSettings = (
  userId: string,
  data: Record<string, boolean | string>,
) =>
  prisma.notificationSettings.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

const _requireRider = async (userId: string) => {
  const rider = await prisma.riderProfile.findUnique({
    where: { userId },
    include: { bankAccounts: true }, // This "hydrates" the relation
  });
  if (!rider) throw AppError.notFound("Rider profile");
  return rider;
};

const _formatDelivery = (d: any) => ({
  id: d.id,
  orderNumber: d.order.orderId,
  storeName: d.order.vendor.storeName,
  storeImage: d.order.vendor.logoUrl,
  phone: d.order.vendor.user?.phone ?? "",
  pickupAddress: d.order.vendor.address ?? "",
  deliveryAddress: d.order.deliveryAddress,
  status: d.status,
  estimatedPickupTime: d.estimatedPickupTime,
  distanceKm: d.distanceKm ?? 0,
  etaMinutes: d.etaMinutes ?? 0,
});

const _formatTx = (tx: any) => ({
  id: tx.id,
  type: tx.type,
  category: tx.category,
  title: tx.title,
  date: new Date(tx.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }),
  time: new Date(tx.createdAt).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  }),
  amount: tx.amount,
  status: tx.status,
});

const _dateLabel = (date: Date): string => {
  const now = new Date();
  const d = new Date(date);
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return "TODAY";
  if (diffDays === 1) return "YESTERDAY";
  return d
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
};

export const getRiderCurrentLocation = async (
  userId: string,
  orderId: string,
) => {
  const rider = await _requireRider(userId);
  const delivery = await prisma.delivery.findFirst({
    where: { riderId: rider.id, order: { orderId } },
  });
  if (!delivery) throw AppError.notFound("Delivery");
  return { lat: rider.currentLat, lng: rider.currentLng };
};

// ─────────────────────────────────────────────────────────────────────────────
// Documents
// ─────────────────────────────────────────────────────────────────────────────

export const getRiderDocuments = async (userId: string) => {
  const rider = await _requireRider(userId);

  const overallStatus = rider.status; // "not_verified" | "pending" | "verified" | "rejected" | "suspended"

  // Map overall status to frontend shape
  const statusMap: Record<
    string,
    "none" | "pending" | "approved" | "rejected" | "partial"
  > = {
    not_verified: "none",
    pending: "pending",
    verified: "approved",
    rejected: "rejected",
    suspended: "rejected",
  };

  const mappedStatus = statusMap[overallStatus] ?? "none";

  // If no docs uploaded at all
  const hasAnyDoc =
    rider.bikeDocUrl ||
    rider.plateImageUrl ||
    rider.idDocUrl ||
    rider.selfieUrl ||
    rider.residenceDocUrl;

  if (!hasAnyDoc) {
    return {
      overallStatus: "none" as const,
      canSubmit: false,
      sections: [],
    };
  }

  // Build sections from rider profile fields
  const sections = [];

  // ── Bike Details ──
  if (rider.vehicleType || rider.bikeDocUrl || rider.plateImageUrl) {
    const bikeItems = [];

    if (rider.bikeVerificationType && rider.bikeDocUrl) {
      bikeItems.push({
        id: "bike_doc",
        label: "Uploaded Document",
        fileName: _extractFileName(rider.bikeDocUrl),
        fileUrl: rider.bikeDocUrl,
        status: _resolveDocStatus(
          overallStatus,
          rider.bikeDocUrl,
          rider.bikeRejectionReason,
        ),
        rejectionReason: rider.bikeRejectionReason ?? null,
      });
    }

    if (rider.vehiclePlate && rider.plateImageUrl) {
      bikeItems.push({
        id: "plate_doc",
        label: "Uploaded Document",
        fileName: _extractFileName(rider.plateImageUrl),
        fileUrl: rider.plateImageUrl,
        status: _resolveDocStatus(
          overallStatus,
          rider.plateImageUrl,
          rider.plateRejectionReason,
        ),
        rejectionReason: rider.plateRejectionReason ?? null,
      });
    }

    sections.push({
      title: "Bike Details",
      meta: [
        rider.bikeVerificationType
          ? `Bike Verification Type\n${rider.bikeVerificationType}`
          : null,
        rider.vehiclePlate ? `Bike Plate Number\n${rider.vehiclePlate}` : null,
      ].filter(Boolean),
      items: bikeItems,
    });
  }

  // ── Identity Verification ──
  if (
    rider.identityType ||
    rider.idDocUrl ||
    rider.selfieUrl ||
    rider.residenceType
  ) {
    const identityItems = [];

    if (rider.identityType && rider.idDocUrl) {
      identityItems.push({
        id: "id_doc",
        label: `Upload ${rider.identityType}`,
        fileName: _extractFileName(rider.idDocUrl),
        fileUrl: rider.idDocUrl,
        status: _resolveDocStatus(
          overallStatus,
          rider.idDocUrl,
          rider.idRejectionReason,
        ),
        rejectionReason: rider.idRejectionReason ?? null,
      });
    }

    if (rider.selfieUrl) {
      identityItems.push({
        id: "selfie_doc",
        label: "Passport Photograph",
        fileName: _extractFileName(rider.selfieUrl),
        fileUrl: rider.selfieUrl,
        status: _resolveDocStatus(
          overallStatus,
          rider.selfieUrl,
          rider.selfieRejectionReason,
        ),
        rejectionReason: rider.selfieRejectionReason ?? null,
      });
    }

    if (rider.residenceType && rider.residenceDocUrl) {
      identityItems.push({
        id: "residence_doc",
        label: "Upload Document",
        fileName: _extractFileName(rider.residenceDocUrl),
        fileUrl: rider.residenceDocUrl,
        status: _resolveDocStatus(
          overallStatus,
          rider.residenceDocUrl,
          rider.residenceRejectionReason,
        ),
        rejectionReason: rider.residenceRejectionReason ?? null,
      });
    }

    sections.push({
      title: "Identity Verification",
      meta: [
        rider.identityType
          ? `Identity Verification Type\n${rider.identityType}`
          : null,
        rider.residenceType
          ? `Proof of Residence Type\n${rider.residenceType}`
          : null,
      ].filter(Boolean),
      items: identityItems,
    });
  }

  // Determine if any doc is rejected
  const allItems = sections.flatMap((s) => s.items);
  const hasRejected = allItems.some((i) => i.status === "rejected");
  const allApproved = allItems.every((i) => i.status === "approved");
  const hasUploaded = allItems.some(
    (i) => i.status === "uploaded" || i.status === "pending",
  );

  // canSubmit: true if there are uploaded/re-uploaded docs and status isn't pending
  const canSubmit =
    mappedStatus !== "pending" &&
    mappedStatus !== "approved" &&
    allItems.length > 0 &&
    !allItems.some((i) => i.status === "rejected");

  // Refine overallStatus
  let finalStatus: "none" | "pending" | "approved" | "rejected" | "partial" =
    mappedStatus;
  if (mappedStatus === "rejected" && !hasRejected) finalStatus = "partial";
  if (allApproved) finalStatus = "approved";

  return {
    overallStatus: finalStatus,
    canSubmit,
    sections,
  };
};

export const uploadRiderDocument = async (
  userId: string,
  documentId: string,
  url: string,
): Promise<{ success: boolean }> => {
  const rider = await _requireRider(userId);

  const fieldMap: Record<string, any> = {
    bike_doc: { bikeDocUrl: url, bikeRejectionReason: null },
    plate_doc: { plateImageUrl: url, plateRejectionReason: null },
    id_doc: { idDocUrl: url, idRejectionReason: null },
    selfie_doc: { selfieUrl: url, selfieRejectionReason: null },
    residence_doc: { residenceDocUrl: url, residenceRejectionReason: null },
  };

  const data = fieldMap[documentId];
  if (!data) throw AppError.badRequest("Invalid document ID.");

  await prisma.riderProfile.update({
    where: { id: rider.id },
    data,
  });

  return { success: true };
};

export const submitRiderDocuments = async (
  userId: string,
): Promise<{ success: boolean }> => {
  const rider = await _requireRider(userId);

  await prisma.riderProfile.update({
    where: { id: rider.id },
    data: { status: "pending" },
  });

  return { success: true };
};

// ── Doc helpers ────────────────────────────────────────────────────────────────

const _extractFileName = (url: string): string => {
  try {
    return url.split("/").pop()?.split("?")[0] ?? "document";
  } catch {
    return "document";
  }
};

const _resolveDocStatus = (
  riderStatus: string,
  docUrl: string | null,
  rejectionReason?: string | null,
): "approved" | "pending" | "rejected" | "uploaded" => {
  if (!docUrl) return "pending";
  if (rejectionReason) return "rejected";
  if (riderStatus === "verified") return "approved";
  if (riderStatus === "pending") return "pending";
  return "uploaded"; // Has a doc but not yet submitted/reviewed
};
