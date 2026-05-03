// src/utils/email.ts
import { config } from "../config";
import { logger } from "../config/logger";

const RESEND_BASE_URL = "https://api.resend.com";
const DEFAULT_FROM = "Rave <no-reply@yourdomain.com>";

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
