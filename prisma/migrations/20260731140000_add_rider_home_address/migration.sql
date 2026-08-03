-- AlterTable: add a dedicated column for the rider's onboarding "Home Address"
-- (step 0), distinct from the GPS-derived "currentAddress" column that
-- onboarding step 1 / live-location updates write to. Previously the frontend
-- and backend shared one column for both, so step 1 silently overwrote
-- whatever step 0 had saved.
ALTER TABLE "rider_profiles" ADD COLUMN "homeAddress" TEXT;
