// src/routes/admin/admin.notifications.routes.ts
//
// The signed-in admin's own notification inbox — unrestricted by adminRole,
// same as admin.me.routes.ts, since every admin reads their own notifications
// regardless of which AdminRole they hold.
import { Router } from "express";
import * as ctrl from "../../controllers/admin/adminNotifications.controller";

const router = Router();

router.get("/", ctrl.getNotifications);
router.patch("/read-all", ctrl.markAllNotificationsRead);
router.patch("/:id/read", ctrl.markNotificationRead);
router.delete("/:id", ctrl.deleteNotification);
router.get("/unread-count", ctrl.getUnreadNotificationCount);

export default router;
