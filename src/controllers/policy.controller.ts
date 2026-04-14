// src/controllers/policy.controller.ts
import { Request, Response } from "express";
import * as policyService from "../services/policy.service";
import { AuthenticatedRequest, extractPagination } from "../types";
import { ok, asyncHandler } from "../utils";

export const getIssues = asyncHandler(async (req: Request, res: Response) => {
  const { id, role } = (req as AuthenticatedRequest).user;
  const result = await policyService.getIssues(
    id,
    role,
    req.query.status as string,
    extractPagination(req.query),
  );
  ok(res, result.issues, "Issues retrieved.", result.meta);
});

export const getIssueById = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = (req as AuthenticatedRequest).user;
    ok(res, await policyService.getIssueById(id, req.params.id));
  },
);

export const submitIssue = asyncHandler(async (req: Request, res: Response) => {
  const { id, role } = (req as AuthenticatedRequest).user;
  // Images are uploaded to Cloudinary by the frontend before this call —
  // URLs arrive as a string array in req.body.attachments
  const issue = await policyService.submitIssue(id, role, {
    urgency: req.body.urgency,
    category: req.body.category,
    description: req.body.description,
    transactionId: req.body.transactionId,
    attachments: req.body.attachments ?? [],
  });
  ok(res, issue, "Issue submitted. Our team will review it shortly.");
});

export const submitFeedback = asyncHandler(
  async (req: Request, res: Response) => {
    const { id, role } = (req as AuthenticatedRequest).user;
    // Images arrive as Cloudinary URLs in req.body.images
    await policyService.submitFeedback(id, role, {
      type: req.body.type,
      message: req.body.message,
      rating: req.body.rating,
      images: req.body.images ?? [],
    });
    ok(res, null, "Thank you for your feedback!");
  },
);

export const getRecentRefs = asyncHandler(
  async (req: Request, res: Response) => {
    const { id, role } = (req as AuthenticatedRequest).user;
    ok(res, await policyService.getRecentRefs(id, role));
  },
);

export const getLegalDocument = asyncHandler(
  async (req: Request, res: Response) => {
    const { role } = (req as AuthenticatedRequest).user;
    ok(res, await policyService.getLegalDocument(role, req.params.slug));
  },
);

export const getHelpCategories = asyncHandler(
  async (req: Request, res: Response) => {
    const { role } = (req as AuthenticatedRequest).user;
    ok(res, await policyService.getHelpCategories(role));
  },
);

export const getHelpCategoryById = asyncHandler(
  async (req: Request, res: Response) => {
    const { role } = (req as AuthenticatedRequest).user;
    const category = await policyService.getHelpCategories(role);
    const found = category.find((c) => c.id === req.params.id);
    if (!found) {
      ok(res, null, "Category not found.");
      return;
    }
    ok(res, found);
  },
);

export const getHelpArticle = asyncHandler(
  async (req: Request, res: Response) => {
    const { role } = (req as AuthenticatedRequest).user;
    ok(res, await policyService.getHelpArticle(role, req.params.articleId));
  },
);
