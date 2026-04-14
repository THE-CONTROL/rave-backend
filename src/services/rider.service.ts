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

  const [user] = await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        ...(fullName && { fullName }),
        ...(phone && { phone }),
        ...(imageUrl && { imageUrl }),
      },
      select: { id: true, fullName: true, phone: true, imageUrl: true },
    }),
    prisma.riderProfile.update({
      where: { userId },
      data: riderData,
    }),
  ]);

  return user;
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

  const bank = rider.riderBankAccounts[0] || null;

  // Determine which steps are done based on data presence
  const step0Done = !!(user?.location && rider.currentAddress); // Address
  const step1Done = !!(rider.currentLat && rider.currentLng); // Location
  const step2Done = !!(rider.vehiclePlate && (rider as any).bikeDocUrl); // Bike
  const step3Done = !!((rider as any).idDocUrl && (rider as any).selfieUrl); // Identity
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
    stateOfResidence: (rider as any).stateOfResidence || null,
    cityOfResidence: (rider as any).cityOfResidence || null,
    homeAddress: user?.location || null,
    currentAddress: rider.currentAddress,
    vehicleType: rider.vehicleType,
    vehiclePlate: rider.vehiclePlate,
    bikeVerificationType: (rider as any).bikeVerificationType || null,
    bikeDocUrl: (rider as any).bikeDocUrl || null,
    plateImageUrl: (rider as any).plateImageUrl || null,
    identityType: (rider as any).identityType || null,
    idDocUrl: (rider as any).idDocUrl || null,
    selfieUrl: (rider as any).selfieUrl || null,
    residenceType: (rider as any).residenceType || null,
    residenceDocUrl: (rider as any).residenceDocUrl || null,
    bank: bank
      ? {
          bank: bank.bank,
          accountNumber: bank.accountNumber,
          name: bank.name,
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

  if (step === 0) {
    // Step 0: Address Details
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
        } as any,
      }),
    ]);
  } else if (step === 1) {
    // Step 1: Current Location
    await prisma.riderProfile.update({
      where: { id: rider.id },
      data: { currentAddress: data.currentAddress },
    });
  } else if (step === 4) {
    // Step 4: Bank Account
    const { bankName, accountName, accountNumber } = data;
    await prisma.riderBankAccount.upsert({
      where: {
        // Assuming a rider only has one primary onboarding bank
        id: rider.riderBankAccounts[0]?.id || "new-id",
      },
      create: {
        riderId: rider.id,
        bank: bankName,
        name: accountName,
        accountNumber: accountNumber,
        isPrimary: true,
      },
      update: {
        bank: bankName,
        name: accountName,
        accountNumber: accountNumber,
      },
    });
  } else {
    // Generic update for steps 2 and 3 (Bike and Identity)
    await prisma.riderProfile.update({
      where: { id: rider.id },
      data: data,
    });
  }

  // Recalculate Progress
  const state = await getRiderOnboardingState(userId);
  const steps = [
    !!state.homeAddress,
    !!state.currentAddress,
    !!state.vehiclePlate,
    !!state.idDocUrl,
    !!state.bank,
  ];
  const setupProgress = Math.round((steps.filter(Boolean).length / 5) * 100);

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
    prisma.riderTransaction.aggregate({
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
  const rider = await _requireRider(userId);

  if (!rider.isOnline)
    throw AppError.badRequest("You must be online to accept orders.");

  // Fetch rider's user record for name/phone
  const riderUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { fullName: true, phone: true },
  });

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      delivery: true,
      user: { select: { id: true, fullName: true } },
      vendor: { select: { storeName: true, lat: true, lng: true } },
    },
  });

  if (!order) throw AppError.notFound("Order");
  if (order.delivery)
    throw AppError.conflict(
      "This order has already been accepted by another rider.",
    );
  if (order.status !== "ready")
    throw AppError.badRequest("This order is not available for pickup.");

  // Calculate real distance/ETA if rider has coordinates
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

  const vendorOtp = genOtp();
  const customerOtp = genOtp();

  await prisma.$transaction([
    prisma.delivery.create({
      data: {
        orderId,
        riderId: rider.id,
        status: "pending",
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
        riderCode: customerOtp.replace(/ /g, ""),
        riderName: riderUser?.fullName ?? null,
        riderPhone: riderUser?.phone ?? null,
      },
    }),
  ]);

  await notif.notifyRiderAssigned(
    order.user.id,
    orderId,
    riderUser?.fullName ?? "Your rider",
  );

  await notif.notifyRiderDeliveryAccepted(
    userId,
    orderId,
    order.vendor.storeName,
  );

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
              menuItem: { select: { imageUrl: true } },
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
      image: i.menuItem?.imageUrl ?? null,
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
      await tx.riderTransaction.create({
        data: {
          riderId: rider.id,
          type: "payment",
          category: "payment",
          title: `Delivery ${delivery.order.orderId}`,
          amount: earnings,
          status: "completed",
        },
      });

      await tx.riderProfile.update({
        where: { id: rider.id },
        data: {
          totalDeliveries: { increment: 1 },
          totalEarnings: { increment: earnings },
        },
      });

      // Update or create earnings summary
      await tx.riderEarningsSummary.upsert({
        where: { riderId: rider.id },
        create: {
          riderId: rider.id,
          availableBalance: earnings,
          pendingBalance: 0,
        },
        update: { availableBalance: { increment: earnings } },
      });
    }
  });

  if (newStatus === "delivered") {
    await notif.notifyOrderDelivered(delivery.order.userId, delivery.orderId);
    if (earnings) await notif.notifyRiderEarningsCredited(userId, earnings);
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
  const delivery = await prisma.delivery.findFirst({
    where: { id: deliveryId, riderId: rider.id },
  });
  if (!delivery) throw AppError.notFound("Delivery");

  await prisma.delivery.update({
    where: { id: deliveryId },
    data: { deliveryProofUrl: fileUrl },
  });
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
      prisma.riderTransaction.aggregate({
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

export const getEarningsSummary = async (userId: string) => {
  const rider = await _requireRider(userId);

  const [summary, totalEarnedAgg, totalWithdrawnAgg, recent] =
    await Promise.all([
      prisma.riderEarningsSummary.findUnique({ where: { riderId: rider.id } }),
      prisma.riderTransaction.aggregate({
        where: { riderId: rider.id, type: "payment", status: "completed" },
        _sum: { amount: true },
      }),
      prisma.riderTransaction.aggregate({
        where: { riderId: rider.id, type: "withdrawal", status: "completed" },
        _sum: { amount: true },
      }),
      prisma.riderTransaction.findMany({
        where: { riderId: rider.id },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

  return {
    totalEarned: totalEarnedAgg._sum.amount ?? 0,
    totalWithdrawn: totalWithdrawnAgg._sum.amount ?? 0,
    availableBalance: summary?.availableBalance ?? 0,
    pendingBalance: summary?.pendingBalance ?? 0,
    recentTransactions: recent.map(_formatTx),
  };
};

export const getFundsSummary = async (userId: string) => {
  const [summary, riderShare] = await Promise.all([
    getEarningsSummary(userId),
    cfg.fees.riderShare(),
  ]);
  // riderShare is the fraction the rider keeps (e.g. 0.70 = 70%)
  return { ...summary, vatRate: riderShare };
};

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
    prisma.riderTransaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.riderTransaction.count({ where }),
  ]);

  return {
    transactions: txs.map(_formatTx),
    meta: buildMeta(total, page, limit),
  };
};

export const getTransactionById = async (userId: string, txId: string) => {
  const rider = await _requireRider(userId);
  const tx = await prisma.riderTransaction.findFirst({
    where: { id: txId, riderId: rider.id },
  });
  if (!tx) throw AppError.notFound("Transaction");
  return _formatTx(tx);
};

export const requestPayout = async (
  userId: string,
  amount: number,
  bankId: string,
): Promise<{ success: boolean }> => {
  const rider = await _requireRider(userId);
  const summary = await prisma.riderEarningsSummary.findUnique({
    where: { riderId: rider.id },
  });

  if (!summary || summary.availableBalance < amount) {
    throw AppError.badRequest("Insufficient available balance.");
  }

  const bank = await prisma.riderBankAccount.findFirst({
    where: { id: bankId, riderId: rider.id },
  });
  if (!bank) throw AppError.notFound("Bank account");

  await prisma.$transaction([
    prisma.riderTransaction.create({
      data: {
        riderId: rider.id,
        type: "withdrawal",
        category: "payout",
        title: `Bank Transfer — ${bank.bank}`,
        amount,
        status: "completed",
      },
    }),
    prisma.riderEarningsSummary.update({
      where: { riderId: rider.id },
      data: { availableBalance: { decrement: amount } },
    }),
  ]);

  return { success: true };
};

// ─────────────────────────────────────────────────────────────────────────────
// Bank accounts
// ─────────────────────────────────────────────────────────────────────────────

export const getBankAccounts = async (userId: string) => {
  const rider = await _requireRider(userId);
  const accounts = await prisma.riderBankAccount.findMany({
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
    bank: string;
    name: string;
    accountNumber: string;
    bankCode?: string;
  },
): Promise<void> => {
  const rider = await _requireRider(userId);
  const count = await prisma.riderBankAccount.count({
    where: { riderId: rider.id },
  });
  await prisma.riderBankAccount.create({
    data: { riderId: rider.id, isPrimary: count === 0, ...data },
  });
};

export const setPrimaryBank = async (
  userId: string,
  bankId: string,
): Promise<void> => {
  const rider = await _requireRider(userId);
  await prisma.$transaction([
    prisma.riderBankAccount.updateMany({
      where: { riderId: rider.id },
      data: { isPrimary: false },
    }),
    prisma.riderBankAccount.update({
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
  const account = await prisma.riderBankAccount.findFirst({
    where: { id: bankId, riderId: rider.id },
  });
  if (!account) throw AppError.notFound("Bank account");
  await prisma.riderBankAccount.delete({ where: { id: bankId } });
};

export const resolveBankName = async (
  bankCode: string,
  accountNumber: string,
): Promise<string> => {
  const paystackKey = process.env.PAYSTACK_SECRET_KEY;
  if (!paystackKey) return "Account Holder Name"; // dev fallback

  try {
    const res = await fetch(
      `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
      { headers: { Authorization: `Bearer ${paystackKey}` } },
    );
    const json = (await res.json()) as {
      status: boolean;
      data?: { account_name: string };
    };
    if (json.status && json.data?.account_name) return json.data.account_name;
    throw new Error("Could not resolve account name.");
  } catch (err: any) {
    throw AppError.badRequest(
      err?.message ?? "Could not resolve account name.",
    );
  }
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
    include: {
      riderBankAccounts: true, // <--- Add this
    },
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
