// src/services/admin/auditLog.service.ts
import { prisma } from "../../config/database";
import { logger } from "../../config/logger";
import { PaginationQuery } from "../../types";
import { parsePagination, buildMeta } from "../../utils";

export interface WriteAuditLogParams {
  adminId: string;
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
}

/**
 * Writes an audit trail row for an admin mutation. A failure here must never
 * block the admin action it's describing — the action already happened, so
 * we log and swallow instead of throwing back into the caller.
 */
export const writeAuditLog = async (
  params: WriteAuditLogParams,
): Promise<void> => {
  try {
    await prisma.auditLog.create({
      data: {
        adminId: params.adminId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        before: params.before as any,
        after: params.after as any,
        ip: params.ip,
        userAgent: params.userAgent,
      },
    });
  } catch (err) {
    logger.error("Failed to write audit log", { err, params });
  }
};

export interface ListAuditLogsQuery extends PaginationQuery {
  adminId?: string;
  entityType?: string;
  action?: string;
  from?: string;
  to?: string;
}

export const listAuditLogs = async (query: ListAuditLogsQuery) => {
  const { page, limit, skip } = parsePagination(query);

  const where = {
    ...(query.adminId && { adminId: query.adminId }),
    ...(query.entityType && { entityType: query.entityType }),
    ...(query.action && { action: query.action }),
    ...((query.from || query.to) && {
      createdAt: {
        ...(query.from && { gte: new Date(query.from) }),
        ...(query.to && { lte: new Date(query.to) }),
      },
    }),
  };

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        admin: { select: { id: true, fullName: true, email: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { logs, meta: buildMeta(total, page, limit) };
};
