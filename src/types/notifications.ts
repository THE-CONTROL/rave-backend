// src/types/notifications.ts
/**
 * Strongly-typed partial update payloads for notification settings.
 * Mirrors the NotificationSettings Prisma model exactly so Prisma
 * accepts them without spreading Record<string, unknown>.
 */

export interface UserNotificationSettingsPayload {
  orderConfirmation?: boolean;
  orderStatusUpdates?: boolean;
  deliveryArrivals?: boolean;
  promos?: boolean;
  newRestaurants?: boolean;
  sound?: string;
}

export interface VendorNotificationSettingsPayload {
  newOrders?: boolean;
  orderStatusUpdates?: boolean;
  riderArrival?: boolean;
  promos?: boolean;
  performanceTips?: boolean;
  reviews?: boolean;
  sound?: string;
}

export type NotificationSettingsPayload =
  | UserNotificationSettingsPayload
  | VendorNotificationSettingsPayload;
