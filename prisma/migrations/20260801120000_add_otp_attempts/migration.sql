-- AlterTable: track failed verification attempts per OTP so a 6-digit code
-- can't be brute-forced indefinitely against the blanket IP rate limiter
-- alone. verifyEmail() rejects once a single OTP row accumulates 5 wrong
-- guesses, independent of how many other requests that IP has made.
ALTER TABLE "otp_codes" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
