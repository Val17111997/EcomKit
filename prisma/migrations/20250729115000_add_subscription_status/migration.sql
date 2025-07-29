-- AlterTable
ALTER TABLE "UsageSubscription" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PENDING';

-- DropIndex
DROP INDEX IF EXISTS "UsageSubscription_shop_key";

-- CreateIndex
CREATE UNIQUE INDEX "UsageSubscription_subscriptionId_key" ON "UsageSubscription"("subscriptionId");
CREATE INDEX "UsageSubscription_shop_idx" ON "UsageSubscription"("shop");