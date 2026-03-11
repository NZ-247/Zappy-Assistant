-- CreateTable
CREATE TABLE "CommandLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT,
    "waUserId" TEXT NOT NULL,
    "waGroupId" TEXT,
    "command" TEXT NOT NULL,
    "inputText" TEXT,
    "resultSummary" TEXT,
    "status" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommandLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommandLog_tenantId_createdAt_idx" ON "CommandLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "CommandLog_waUserId_createdAt_idx" ON "CommandLog"("waUserId", "createdAt");

-- CreateIndex
CREATE INDEX "CommandLog_waGroupId_createdAt_idx" ON "CommandLog"("waGroupId", "createdAt");
