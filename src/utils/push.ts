import Expo, { ExpoPushMessage } from "expo-server-sdk";
import { logger } from "../config/logger";

const expo = new Expo();

export interface PushPayload {
  token: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
}

/**
 * Sends a push notification via Expo's push service.
 * Silently logs errors — never throws, so a push failure never breaks
 * the business logic that triggered it.
 */
export const sendPush = async (payload: PushPayload): Promise<void> => {
  if (!Expo.isExpoPushToken(payload.token)) {
    logger.warn(`Invalid Expo push token: ${payload.token}`);
    return;
  }

  const message: ExpoPushMessage = {
    to: payload.token,
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    sound: payload.sound ?? "default",
    badge: payload.badge,
  };

  try {
    const chunks = expo.chunkPushNotifications([message]);
    for (const chunk of chunks) {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      for (const ticket of tickets) {
        if (ticket.status === "error") {
          logger.warn("Push notification error", { details: ticket.details });
          // If the token is invalid, we should remove it
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
  const valid = tokens.filter(Expo.isExpoPushToken);
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
