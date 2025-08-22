-- CreateTable
CREATE TABLE "UsageBillingState" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "billedTier" INTEGER NOT NULL DEFAULT 0,
    "billedAmount" REAL NOT NULL DEFAULT 0,
    "lastIdemKey" TEXT
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
    "confirmationUrl" TEXT
);
INSERT INTO "new_UsageSubscription" ("confirmationUrl", "cycleStart", "id", "lineItemId", "orderCount", "shop", "status", "subscriptionId") SELECT "confirmationUrl", "cycleStart", "id", "lineItemId", "orderCount", "shop", "status", "subscriptionId" FROM "UsageSubscription";
DROP TABLE "UsageSubscription";
ALTER TABLE "new_UsageSubscription" RENAME TO "UsageSubscription";
CREATE UNIQUE INDEX "UsageSubscription_subscriptionId_key" ON "UsageSubscription"("subscriptionId");
CREATE INDEX "UsageSubscription_shop_idx" ON "UsageSubscription"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "UsageBillingState_lastIdemKey_key" ON "UsageBillingState"("lastIdemKey");

-- CreateIndex
CREATE UNIQUE INDEX "UsageBillingState_shop_periodKey_key" ON "UsageBillingState"("shop", "periodKey");
