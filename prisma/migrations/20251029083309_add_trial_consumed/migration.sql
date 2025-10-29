/*
  Warnings:

  - You are about to drop the `UsageBillingState` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropIndex
DROP INDEX "UsageBillingState_shop_periodKey_key";

-- DropIndex
DROP INDEX "UsageBillingState_lastIdemKey_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "UsageBillingState";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "usageBillingState" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "billedTier" INTEGER NOT NULL DEFAULT 0,
    "billedAmount" REAL NOT NULL DEFAULT 0,
    "lastIdemKey" TEXT,
    "processingToken" TEXT,
    "lastProcessedAt" DATETIME
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UsageSubscription" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "lineItemId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "cycleStart" DATETIME,
    "confirmationUrl" TEXT,
    "trialConsumed" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_UsageSubscription" ("confirmationUrl", "cycleStart", "id", "lineItemId", "orderCount", "shop", "status", "subscriptionId") SELECT "confirmationUrl", "cycleStart", "id", "lineItemId", "orderCount", "shop", "status", "subscriptionId" FROM "UsageSubscription";
DROP TABLE "UsageSubscription";
ALTER TABLE "new_UsageSubscription" RENAME TO "UsageSubscription";
CREATE UNIQUE INDEX "UsageSubscription_subscriptionId_key" ON "UsageSubscription"("subscriptionId");
CREATE INDEX "UsageSubscription_shop_idx" ON "UsageSubscription"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "usageBillingState_shop_periodKey_key" ON "usageBillingState"("shop", "periodKey");
