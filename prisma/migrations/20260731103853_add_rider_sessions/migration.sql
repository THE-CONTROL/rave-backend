-- CreateTable: tracks each online/offline toggle as a session row so real
-- "Online Time" can be computed (sum of endedAt-startedAt, or now-startedAt
-- while still open) instead of the previously hardcoded "0h 0m" literal.
CREATE TABLE "rider_sessions" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "rider_sessions_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "rider_sessions" ADD CONSTRAINT "rider_sessions_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "rider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
