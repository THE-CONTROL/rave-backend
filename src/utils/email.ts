// src/utils/email.ts
import { config } from "../config";
import { logger } from "../config/logger";

const RESEND_BASE_URL = "https://api.resend.com";
// ⚠ PLACEHOLDER — "Sendpiper" was leftover boilerplate from an unrelated
// product, not a real Rave sending identity. Sourced from config.email.from
// (EMAIL_FROM env var, see src/config/index.ts) — set it to the real
// "Display Name<address@yourdomain>" once the sending domain is set up
// (SPF/DKIM records configured with Resend), otherwise this placeholder
// domain will not deliver reliably.
const DEFAULT_FROM = config.email.from;

interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
}

const sendResend = async (opts: SendMailOptions): Promise<void> => {
  const response = await fetch(`${RESEND_BASE_URL}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.email.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: DEFAULT_FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    }),
  });

  if (!response.ok) {
    const error = (await response.json()) as { message?: string };
    throw new Error(
      `Resend error ${response.status}: ${error.message ?? "Unknown error"}`,
    );
  }
};

export const sendMail = async (opts: SendMailOptions): Promise<void> => {
  if (config.isDev && !config.email.resendApiKey) {
    logger.info(`[DEV] Email to ${opts.to}: ${opts.subject}`);
    return;
  }
  await sendResend(opts);
};

export const sendOtpEmail = (
  to: string,
  name: string,
  otp: string,
  purpose: string,
): Promise<void> => {
  const purposeConfigs: Record<
    string,
    { subject: string; action: string; context?: string }
  > = {
    "verify-account": {
      subject: "Verify your Rave account",
      action: "verify your account",
    },
    "reset-password": {
      subject: "Reset your Rave password",
      action: "reset your password",
    },
    "order-delivery-code": {
      subject: "Your delivery confirmation code",
      action: "confirm your delivery",
      context: "Share this code with your rider when they arrive at your door.",
    },
    "vendor-pickup-code": {
      subject: "Order pickup confirmation code",
      action: "confirm the rider pickup",
      context:
        "Share this code with the rider when they arrive to collect the order.",
    },
  };

  const matched = purposeConfigs[purpose] ?? {
    subject: "Your Rave OTP",
    action: "complete your request",
  };

  const contextHtml = matched.context
    ? `<p style="color:#555;font-size:14px">${matched.context}</p>`
    : "";

  return sendMail({
    to,
    subject: matched.subject,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2>Hello, ${name}!</h2>
        <p>Use the code below to ${matched.action}. It expires in <strong>10 minutes</strong>.</p>
        ${contextHtml}
        <div style="font-size:36px;font-weight:bold;letter-spacing:8px;text-align:center;
                    padding:20px;background:#f4f4f4;border-radius:8px;margin:20px 0">
          ${otp}
        </div>
        <p style="color:#888;font-size:12px">
          If you didn't request this, please ignore this email.
        </p>
      </div>
    `,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Bulk send — admin broadcast emails (single user, role group, or everyone).
// There's no job queue in this codebase, and Resend's REST API here is
// one-recipient-per-call, so a few-thousand-recipient blast would hold an
// HTTP request open far too long if sent synchronously in a loop. Batches
// with a short delay between chunks instead of firing everything at once.
// ─────────────────────────────────────────────────────────────────────────────

const BULK_BATCH_SIZE = 20;
const BULK_BATCH_DELAY_MS = 500;

export const sendBulkMail = async (
  recipients: string[],
  subject: string,
  html: string,
): Promise<{ sent: number; failed: number }> => {
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i += BULK_BATCH_SIZE) {
    const batch = recipients.slice(i, i + BULK_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((to) => sendMail({ to, subject, html })),
    );

    for (const result of results) {
      if (result.status === "fulfilled") sent++;
      else {
        failed++;
        logger.error("[bulk email] delivery failed", result.reason);
      }
    }

    if (i + BULK_BATCH_SIZE < recipients.length) {
      await new Promise((resolve) => setTimeout(resolve, BULK_BATCH_DELAY_MS));
    }
  }

  return { sent, failed };
};

export const sendWelcomeEmail = (to: string, name: string): Promise<void> =>
  sendMail({
    to,
    subject: "Welcome to Rave! 🎉",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2>Welcome to Rave, ${name}!</h2>
        <p>Your account has been verified. Start exploring trusted food vendors near you.</p>
      </div>
    `,
  });
