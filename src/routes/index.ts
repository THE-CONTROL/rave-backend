// src/routes/index.ts
import { Router } from "express";
import authRoutes from "./auth.routes";
import userRoutes from "./user.routes";
import vendorRoutes from "./vendor.routes";
import riderRoutes from "./rider.routes";
import catalogRoutes from "./catalog.routes";
import policyRoutes from "./policy.routes";
import adRoutes from "./ad.routes";
import paymentRoutes from "./payment.routes";
import optionGroupRoutes from "./optionGroup.routes";

const router = Router();

// Health check — no auth required
router.get("/health", (_req, res) => {
  res.json({
    success: true,
    message: "Rave API is running",
    timestamp: new Date().toISOString(),
  });
});

router.use("/auth", authRoutes);
router.use("/user", userRoutes);
router.use("/vendor", vendorRoutes);
router.use("/rider", riderRoutes);
router.use("/catalog", catalogRoutes);
router.use("/policy", policyRoutes);
router.use("/ads", adRoutes);
router.use("/payments", paymentRoutes);
router.use("/vendor/option-groups", optionGroupRoutes);

export default router;
