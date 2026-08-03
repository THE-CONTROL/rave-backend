// src/services/admin/emailAdmin.service.ts
//
// Admin broadcast email: a single account, every account of one or more
// roles, or the whole platform (roles: ["user","vendor","rider"]). Deacti-
// vated accounts are always excluded — their email was anonymized to
// deleted_<id>@rave.com on deletion, so sending would just bounce.
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";
import { logger } from "../../config/logger";
import { sendBulkMail } from "../../utils/email";

// Hard safety cap — a single broadcast beyond this must be narrowed rather
// than silently loading tens of thousands of rows and firing that many
// outbound API calls from one request.
const MAX_RECIPIENTS = 5000;

export type BroadcastRole = "user" | "vendor" | "rider";

export interface SendEmailDto {
  subject: string;
  message: string;
  recipientId?: string;
  roles?: BroadcastRole[];
}

interface Recipient {
  id: string;
  email: string;
  fullName: string;
}

const resolveRecipients = async (dto: SendEmailDto): Promise<Recipient[]> => {
  if (dto.recipientId) {
    const user = await prisma.user.findUnique({
      where: { id: dto.recipientId },
      select: { id: true, email: true, fullName: true, isActive: true },
    });
    if (!user) throw AppError.notFound("Recipient");
    if (!user.isActive) {
      throw AppError.badRequest(
        "This account is deactivated and has no valid email on file.",
      );
    }
    return [user];
  }

  if (!dto.roles?.length) {
    throw AppError.badRequest("Specify a recipientId or at least one role.");
  }

  return prisma.user.findMany({
    where: { role: { in: dto.roles }, isActive: true },
    select: { id: true, email: true, fullName: true },
  });
};

const buildHtml = (message: string): string => `
  <div style="font-family:sans-serif;max-width:480px;margin:auto">
    <div style="white-space:pre-wrap;line-height:1.6;color:#111">${message}</div>
    <p style="margin-top:32px;font-size:12px;color:#888">— The Rave Team</p>
  </div>
`;

export const sendBulkEmail = async (
  dto: SendEmailDto,
): Promise<{ recipientCount: number }> => {
  const recipients = await resolveRecipients(dto);

  if (recipients.length === 0) {
    throw AppError.badRequest("No matching recipients found.");
  }
  if (recipients.length > MAX_RECIPIENTS) {
    throw AppError.badRequest(
      `This would email ${recipients.length} recipients, over the ${MAX_RECIPIENTS}-recipient safety cap. Narrow the audience.`,
    );
  }

  const html = buildHtml(dto.message);

  // Fire in the background — the caller gets the recipient count back
  // immediately rather than holding the HTTP request open for a
  // potentially large batched send. Success/failure is logged, not awaited.
  sendBulkMail(
    recipients.map((r) => r.email),
    dto.subject,
    html,
  )
    .then(({ sent, failed }) => {
      logger.info(
        `Admin broadcast "${dto.subject}" — sent ${sent}, failed ${failed} (of ${recipients.length})`,
      );
    })
    .catch((err) => {
      logger.error("Admin broadcast email failed", err);
    });

  return { recipientCount: recipients.length };
};
