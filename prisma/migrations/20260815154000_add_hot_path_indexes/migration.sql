-- CreateIndex: vendor/rider wallet & transaction-history queries filter by
-- (vendorId|riderId, type, status) — e.g. "this vendor's completed payout
-- transactions" — and previously only had the unrelated orderId index to
-- fall back on, forcing a full scan of the transactions table as it grows.
CREATE INDEX "transactions_vendorId_type_status_idx" ON "transactions"("vendorId", "type", "status");
CREATE INDEX "transactions_riderId_type_status_idx" ON "transactions"("riderId", "type", "status");

-- CreateIndex: OTP lookups are always "most recent code for this user +
-- purpose" (signup verify / password reset / resend), ordered by createdAt.
CREATE INDEX "otp_codes_userId_purpose_createdAt_idx" ON "otp_codes"("userId", "purpose", "createdAt");

-- CreateIndex: refresh tokens are deleted/looked up by userId on sign-out
-- and token rotation.
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex: notification inbox reads are always "this user's
-- notifications, newest first".
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex: search history reads are always "this user's recent
-- searches".
CREATE INDEX "search_history_userId_createdAt_idx" ON "search_history"("userId", "createdAt");
