-- Governance capability policy foundation (v1.8.0)

CREATE TYPE "CapabilityOverrideMode" AS ENUM ('ALLOW', 'DENY');

CREATE TABLE "CapabilityDefinition" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CapabilityDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CapabilityDefinition_key_key" ON "CapabilityDefinition"("key");
CREATE INDEX "CapabilityDefinition_active_idx" ON "CapabilityDefinition"("active");

CREATE TABLE "CapabilityBundle" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CapabilityBundle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CapabilityBundle_key_key" ON "CapabilityBundle"("key");
CREATE INDEX "CapabilityBundle_active_idx" ON "CapabilityBundle"("active");

CREATE TABLE "CapabilityBundleCapability" (
  "id" TEXT NOT NULL,
  "bundleId" TEXT NOT NULL,
  "capabilityId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CapabilityBundleCapability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CapabilityBundleCapability_bundleId_capabilityId_key" ON "CapabilityBundleCapability"("bundleId", "capabilityId");
CREATE INDEX "CapabilityBundleCapability_capabilityId_idx" ON "CapabilityBundleCapability"("capabilityId");

CREATE TABLE "TierBundleDefault" (
  "id" TEXT NOT NULL,
  "tier" "LicenseTier" NOT NULL,
  "bundleId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TierBundleDefault_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TierBundleDefault_tier_bundleId_key" ON "TierBundleDefault"("tier", "bundleId");
CREATE INDEX "TierBundleDefault_bundleId_idx" ON "TierBundleDefault"("bundleId");

CREATE TABLE "UserBundleAssignment" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "waUserId" TEXT NOT NULL,
  "bundleId" TEXT NOT NULL,
  "assignedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserBundleAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserBundleAssignment_tenantId_waUserId_bundleId_key" ON "UserBundleAssignment"("tenantId", "waUserId", "bundleId");
CREATE INDEX "UserBundleAssignment_waUserId_idx" ON "UserBundleAssignment"("waUserId");
CREATE INDEX "UserBundleAssignment_bundleId_idx" ON "UserBundleAssignment"("bundleId");

CREATE TABLE "GroupBundleAssignment" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "waGroupId" TEXT NOT NULL,
  "bundleId" TEXT NOT NULL,
  "assignedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GroupBundleAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GroupBundleAssignment_tenantId_waGroupId_bundleId_key" ON "GroupBundleAssignment"("tenantId", "waGroupId", "bundleId");
CREATE INDEX "GroupBundleAssignment_waGroupId_idx" ON "GroupBundleAssignment"("waGroupId");
CREATE INDEX "GroupBundleAssignment_bundleId_idx" ON "GroupBundleAssignment"("bundleId");

CREATE TABLE "UserCapabilityOverride" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "waUserId" TEXT NOT NULL,
  "capabilityKey" TEXT NOT NULL,
  "mode" "CapabilityOverrideMode" NOT NULL,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserCapabilityOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserCapabilityOverride_tenantId_waUserId_capabilityKey_key" ON "UserCapabilityOverride"("tenantId", "waUserId", "capabilityKey");
CREATE INDEX "UserCapabilityOverride_waUserId_idx" ON "UserCapabilityOverride"("waUserId");
CREATE INDEX "UserCapabilityOverride_capabilityKey_idx" ON "UserCapabilityOverride"("capabilityKey");

CREATE TABLE "GroupCapabilityOverride" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "waGroupId" TEXT NOT NULL,
  "capabilityKey" TEXT NOT NULL,
  "mode" "CapabilityOverrideMode" NOT NULL,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GroupCapabilityOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GroupCapabilityOverride_tenantId_waGroupId_capabilityKey_key" ON "GroupCapabilityOverride"("tenantId", "waGroupId", "capabilityKey");
CREATE INDEX "GroupCapabilityOverride_waGroupId_idx" ON "GroupCapabilityOverride"("waGroupId");
CREATE INDEX "GroupCapabilityOverride_capabilityKey_idx" ON "GroupCapabilityOverride"("capabilityKey");

ALTER TABLE "CapabilityBundleCapability"
  ADD CONSTRAINT "CapabilityBundleCapability_bundleId_fkey"
  FOREIGN KEY ("bundleId") REFERENCES "CapabilityBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CapabilityBundleCapability"
  ADD CONSTRAINT "CapabilityBundleCapability_capabilityId_fkey"
  FOREIGN KEY ("capabilityId") REFERENCES "CapabilityDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TierBundleDefault"
  ADD CONSTRAINT "TierBundleDefault_bundleId_fkey"
  FOREIGN KEY ("bundleId") REFERENCES "CapabilityBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserBundleAssignment"
  ADD CONSTRAINT "UserBundleAssignment_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserBundleAssignment"
  ADD CONSTRAINT "UserBundleAssignment_bundleId_fkey"
  FOREIGN KEY ("bundleId") REFERENCES "CapabilityBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GroupBundleAssignment"
  ADD CONSTRAINT "GroupBundleAssignment_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GroupBundleAssignment"
  ADD CONSTRAINT "GroupBundleAssignment_bundleId_fkey"
  FOREIGN KEY ("bundleId") REFERENCES "CapabilityBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserCapabilityOverride"
  ADD CONSTRAINT "UserCapabilityOverride_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GroupCapabilityOverride"
  ADD CONSTRAINT "GroupCapabilityOverride_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
