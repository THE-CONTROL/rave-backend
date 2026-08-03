// src/services/admin/issueAdmin.service.ts
import { IssueStatus, Role } from "@prisma/client";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";
import { PaginationQuery } from "../../types";
import { parsePagination, buildMeta } from "../../utils";

export interface ListIssuesQuery extends PaginationQuery {
  status?: IssueStatus;
  role?: Role;
  category?: string;
}

// Admin sees every user's tickets — no userId scoping, unlike the user-facing
// reads in policy.service.ts (getIssues/getIssueById), which stay untouched.
export const listIssues = async (query: ListIssuesQuery) => {
  const { page, limit, skip } = parsePagination(query);

  const where = {
    ...(query.status && { status: query.status }),
    ...(query.role && { role: query.role }),
    ...(query.category && { category: query.category }),
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
  return issue;
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

  return prisma.reportedIssue.update({ where: { id }, data: { status } });
};

export const respondToIssue = async (
  id: string,
  adminId: string,
  message: string,
) => {
  await getIssueDetail(id);

  return prisma.reportedIssue.update({
    where: { id },
    data: {
      adminResponse: message,
      respondedAt: new Date(),
      respondedBy: adminId,
      status: "IN_REVIEW",
    },
  });
};
