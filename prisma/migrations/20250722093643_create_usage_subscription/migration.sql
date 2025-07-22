-- CreateTable
CREATE TABLE "UsageSubscription" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "lineItemId" TEXT NOT NULL,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "cycleStart" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "UsageSubscription_shop_key" ON "UsageSubscription"("shop");
