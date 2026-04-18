// src/routes/catalog.routes.ts
import { Router } from "express";
import * as ctrl from "../controllers/catalog.controller";
import { optionalAuth } from "../middleware/auth"; // relative, not @/

const router = Router();

// All catalog routes are public — auth is optional for isFavorite/isYourUsual state
router.get("/restaurants", optionalAuth, ctrl.getNearbyRestaurants);
router.get("/restaurants/:id", optionalAuth, ctrl.getRestaurantDetails);
router.get("/restaurants/:id/menu", ctrl.getRestaurantMenu);
router.get("/restaurants/:id/categories", ctrl.getRestaurantCategories);
router.get("/restaurants/:id/reviews", ctrl.getRestaurantReviews);
router.get("/restaurants/:id/rating-distribution", ctrl.getRatingDistribution);

router.get("/products/:id", optionalAuth, ctrl.getProductDetails);
router.get("/products/:id/reviews", ctrl.getProductReviews);

router.get("/search", optionalAuth, ctrl.search);
router.get("/categories", ctrl.getFoodCategories);
router.get("/categories/:name/items", ctrl.getItemsByCategory);
router.get("/breakfast-picks", optionalAuth, ctrl.getBreakfastPicks);

router.get("/vendors", optionalAuth, ctrl.getAllVendors);
router.get("/menu-items", optionalAuth, ctrl.getAllMenuItems);

export default router;
