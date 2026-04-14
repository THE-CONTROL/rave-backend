// src/utils/email.ts
import nodemailer from "nodemailer";
import { config } from "../config";
import { logger } from "../config/logger";

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: config.email.port === 465,
  auth: { user: config.email.user, pass: config.email.pass },
});

interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
}

export const sendMail = async (opts: SendMailOptions): Promise<void> => {
  if (config.isDev && !config.email.user) {
    logger.info(`[DEV] Email to ${opts.to}: ${opts.subject}`);
    return;
  }
  await transporter.sendMail({ from: config.email.from, ...opts });
};

// ─── Email templates ──────────────────────────────────────────────────────────

export const sendOtpEmail = (
  to: string,
  name: string,
  otp: string,
  purpose: string,
): Promise<void> => {
  const subject =
    purpose === "verify-account"
      ? "Verify your Rave account"
      : "Reset your Rave password";

  const action =
    purpose === "verify-account"
      ? "verify your account"
      : "reset your password";

  return sendMail({
    to,
    subject,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2>Hello, ${name}!</h2>
        <p>Use the code below to ${action}. It expires in <strong>10 minutes</strong>.</p>
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
