-- CreateEnum
CREATE TYPE "AccessStatus" AS ENUM ('PENDING', 'APPROVED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "LicenseTier" AS ENUM ('FREE', 'BASIC', 'PRO', 'ROOT');

-- CreateEnum
CREATE TYPE "AccessSubjectType" AS ENUM ('USER', 'GROUP');

-- CreateTable
CREATE TABLE "UserAccess" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "waUserId" TEXT NOT NULL,
  "phoneNumber" TEXT,
  "displayName" TEXT,
  "status" "AccessStatus" NOT NULL DEFAULT 'PENDING',
  "tier" "LicenseTier" NOT NULL DEFAULT 'FREE',
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupAccess" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "waGroupId" TEXT NOT NULL,
  "groupName" TEXT,
  "status" "AccessStatus" NOT NULL DEFAULT 'PENDING',
  "tier" "LicenseTier" NOT NULL DEFAULT 'FREE',
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GroupAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicensePlan" (
  "id" TEXT NOT NULL,
  "tier" "LicenseTier" NOT NULL,
  "displayName" TEXT NOT NULL,
  "description" TEXT,
  "capabilityDefaults" JSONB,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LicensePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
  "id" TEXT NOT NULL,
  "subjectType" "AccessSubjectType" NOT NULL,
  "subjectId" TEXT NOT NULL,
  "bucket" TEXT NOT NULL,
  "periodKey" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalAudit" (
  "id" TEXT NOT NULL,
  "subjectType" "AccessSubjectType" NOT NULL,
  "subjectId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ApprovalAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserAccess_tenantId_waUserId_key" ON "UserAccess"("tenantId", "waUserId");

-- CreateIndex
CREATE INDEX "UserAccess_tenantId_idx" ON "UserAccess"("tenantId");

-- CreateIndex
CREATE INDEX "UserAccess_status_idx" ON "UserAccess"("status");

-- CreateIndex
CREATE INDEX "UserAccess_tier_idx" ON "UserAccess"("tier");

-- CreateIndex
CREATE UNIQUE INDEX "GroupAccess_tenantId_waGroupId_key" ON "GroupAccess"("tenantId", "waGroupId");

-- CreateIndex
CREATE INDEX "GroupAccess_tenantId_idx" ON "GroupAccess"("tenantId");

-- CreateIndex
CREATE INDEX "GroupAccess_status_idx" ON "GroupAccess"("status");

-- CreateIndex
CREATE INDEX "GroupAccess_tier_idx" ON "GroupAccess"("tier");

-- CreateIndex
CREATE UNIQUE INDEX "LicensePlan_tier_key" ON "LicensePlan"("tier");

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_subjectType_subjectId_bucket_periodKey_key" ON "UsageCounter"("subjectType", "subjectId", "bucket", "periodKey");

-- CreateIndex
CREATE INDEX "UsageCounter_subjectType_subjectId_idx" ON "UsageCounter"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "UsageCounter_bucket_periodKey_idx" ON "UsageCounter"("bucket", "periodKey");

-- CreateIndex
CREATE INDEX "ApprovalAudit_subjectType_subjectId_createdAt_idx" ON "ApprovalAudit"("subjectType", "subjectId", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalAudit_createdAt_idx" ON "ApprovalAudit"("createdAt");

-- AddForeignKey
ALTER TABLE "UserAccess" ADD CONSTRAINT "UserAccess_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupAccess" ADD CONSTRAINT "GroupAccess_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
