// src/services/admin/issueAdmin.service.ts
import { IssueStatus, Role } from "@prisma/client";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";
import { PaginationQuery } from "../../types";
import { parsePagination, buildMeta } from "../../utils";
import * as notif from "../../events/notification.events";

export interface ListIssuesQuery extends PaginationQuery {
  status?: IssueStatus;
  role?: Role;
  category?: string;
  userId?: string;
}

// Admin sees every user's tickets by default; userId narrows to one (e.g.
// from a "View support tickets" link on that user's admin detail page).
export const listIssues = async (query: ListIssuesQuery) => {
  const { page, limit, skip } = parsePagination(query);

  const where = {
    ...(query.status && { status: query.status }),
    ...(query.role && { role: query.role }),
    ...(query.category && { category: query.category }),
    ...(query.userId && { userId: query.userId }),
  };

  const [issues, total] = await Promise.all([
    prisma.reportedIssue.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: { user: { select: { id: true, fullName: true, email: true } } },
    }),
    prisma.reportedIssue.count({ where }),
  ]);

  return { issues, meta: buildMeta(total, page, limit) };
};

export const getIssueDetail = async (id: string) => {
  const issue = await prisma.reportedIssue.findUnique({
    where: { id },
    include: { user: { select: { id: true, fullName: true, email: true, phone: true } } },
  });
  if (!issue) throw AppError.notFound("Support ticket");

  const respondedByAdmin = issue.respondedBy
    ? await prisma.user.findUnique({ where: { id: issue.respondedBy }, select: { fullName: true } })
    : null;

  return { ...issue, respondedByName: respondedByAdmin?.fullName ?? null };
};

// Forward-only transition, mirroring ORDER_STATUS_TRANSITIONS' pattern.
const ISSUE_STATUS_TRANSITIONS: Record<IssueStatus, IssueStatus[]> = {
  OPEN: ["IN_REVIEW", "RESOLVED"],
  IN_REVIEW: ["RESOLVED"],
  RESOLVED: [],
};

export const updateIssueStatus = async (id: string, status: IssueStatus) => {
  const issue = await getIssueDetail(id);

  if (
    issue.status !== status &&
    !ISSUE_STATUS_TRANSITIONS[issue.status].includes(status)
  ) {
    throw AppError.badRequest(
      `Cannot move a ticket from ${issue.status} to ${status}.`,
    );
  }

  const updated = await prisma.reportedIssue.update({
    where: { id },
    data: { status },
  });

  if (issue.status !== status && (status === "IN_REVIEW" || status === "RESOLVED")) {
    await notif.notifyIssueUpdated(updated.userId, status, updated.adminResponse);
  }

  return updated;
};

export const respondToIssue = async (
  id: string,
  adminId: string,
  message: string,
) => {
  await getIssueDetail(id);

  const updated = await prisma.reportedIssue.update({
    where: { id },
    data: {
      adminResponse: message,
      respondedAt: new Date(),
      respondedBy: adminId,
      status: "IN_REVIEW",
    },
  });

  await notif.notifyIssueUpdated(updated.userId, "IN_REVIEW", message);

  return updated;
};
