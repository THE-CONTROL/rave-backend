import { logger } from "../config/logger";
import type { ExpoPushMessage } from "expo-server-sdk";

// Lazily loaded — expo-server-sdk ships an ESM build that require() can't
// load synchronously, so we pull it in via dynamic import on first use.
let expoInstance: any = null;
let ExpoClass: any = null;

async function getExpo() {
  if (!expoInstance) {
    const mod = await import("expo-server-sdk");
    ExpoClass = mod.Expo;
    expoInstance = new ExpoClass();
  }
  return expoInstance;
}

export interface PushPayload {
  token: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | string | null;
  channelId?: string;
  badge?: number;
}

/**
 * Sends a push notification via Expo's push service.
 * Silently logs errors — never throws, so a push failure never breaks
 * the business logic that triggered it.
 */
export const sendPush = async (payload: PushPayload): Promise<void> => {
  const expo = await getExpo();

  if (!ExpoClass.isExpoPushToken(payload.token)) {
    logger.warn(`Invalid Expo push token: ${payload.token}`);
    return;
  }

  const message: ExpoPushMessage = {
    to: payload.token,
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    sound: payload.sound === undefined ? "default" : (payload.sound as any),
    ...(payload.channelId ? { channelId: payload.channelId } : {}),
    badge: payload.badge,
  };

  try {
    const chunks = expo.chunkPushNotifications([message]);
    for (const chunk of chunks) {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      for (const ticket of tickets) {
        if (ticket.status === "error") {
          logger.warn("Push notification error", { details: ticket.details });
          if (ticket.details?.error === "DeviceNotRegistered") {
            logger.info("Token is no longer valid — should be cleared");
          }
        }
      }
    }
  } catch (err) {
    logger.error("Failed to send push notification", err);
  }
};

/**
 * Sends push to multiple tokens at once (e.g. notify all online riders)
 */
export const sendPushToMany = async (
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> => {
  const expo = await getExpo();

  const valid = tokens.filter((t) => ExpoClass.isExpoPushToken(t));
  if (!valid.length) return;

  const messages: ExpoPushMessage[] = valid.map((to) => ({
    to,
    title,
    body,
    data: data ?? {},
    sound: "default",
  }));

  try {
    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk);
    }
  } catch (err) {
    logger.error("Failed to send bulk push notifications", err);
  }
};
