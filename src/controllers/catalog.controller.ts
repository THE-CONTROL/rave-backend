// src/controllers/catalog.controller.ts
import { Request, Response } from "express";
import * as catalogService from "../services/catalog.service";
import { AuthenticatedRequest, extractPagination } from "../types";
import { ok, asyncHandler } from "../utils";

const optionalUid = (req: Request): string | undefined =>
  (req as AuthenticatedRequest).user?.id;

export const getNearbyRestaurants = asyncHandler(async (req, res) => {
  const result = await catalogService.getNearbyRestaurants(
    req.query as any,
    optionalUid(req),
  );
  ok(res, result);
});

export const getRestaurantDetails = asyncHandler(async (req, res) => {
  ok(
    res,
    await catalogService.getRestaurantDetails(req.params.id, optionalUid(req)),
  );
});

export const getRestaurantMenu = asyncHandler(async (req, res) => {
  ok(
    res,
    await catalogService.getRestaurantMenu(
      req.params.id,
      req.query.categoryId as string,
    ),
  );
});

export const getRestaurantCategories = asyncHandler(async (req, res) => {
  ok(res, await catalogService.getRestaurantCategories(req.params.id));
});

export const getRestaurantReviews = asyncHandler(async (req, res) => {
  const result = await catalogService.getRestaurantReviews(
    req.params.id,
    req.query as any,
  );
  ok(res, result.reviews, "Reviews retrieved.", result.meta);
});

export const getProductDetails = asyncHandler(async (req, res) => {
  ok(
    res,
    await catalogService.getProductDetails(req.params.id, optionalUid(req)),
  );
});

export const getProductReviews = asyncHandler(async (req, res) => {
  const result = await catalogService.getProductReviews(
    req.params.id,
    req.query as any,
  );
  ok(res, result.reviews, "Reviews retrieved.", result.meta);
});

export const search = asyncHandler(async (req, res) => {
  const { q = "", type = "all" } = req.query as { q?: string; type?: string };
  const result = await catalogService.search(
    q,
    type as "restaurants" | "foods" | "all",
    req.query as any,
    optionalUid(req),
  );
  ok(res, result);
});

export const getFoodCategories = asyncHandler(async (_req, res) => {
  ok(res, await catalogService.getFoodCategories());
});

export const getItemsByCategory = asyncHandler(async (req, res) => {
  const result = await catalogService.getItemsByCategory(
    req.params.name,
    req.query as any,
  );
  ok(res, result.items, "Items retrieved.", result.meta);
});

export const getBreakfastPicks = asyncHandler(async (req, res) => {
  ok(res, await catalogService.getBreakfastPicks());
});

export const getRatingDistribution = asyncHandler(async (req, res) => {
  ok(res, await catalogService.getRatingDistribution(req.params.id));
});

export const getAllVendors = asyncHandler(async (req, res) => {
  const result = await catalogService.getAllVendors(
    req.query as any,
    optionalUid(req),
  );
  ok(res, result.data, "Vendors retrieved.", result.meta);
});

export const getAllMenuItems = asyncHandler(async (req, res) => {
  const result = await catalogService.getAllMenuItems(
    req.query as any,
    optionalUid(req),
  );
  ok(res, result.data, "Menu items retrieved.", result.meta);
});
