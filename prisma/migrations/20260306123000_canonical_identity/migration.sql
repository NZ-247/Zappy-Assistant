-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "lidJid" TEXT,
  ADD COLUMN "permissionRole" TEXT,
  ADD COLUMN "phoneNumber" TEXT,
  ADD COLUMN "pnJid" TEXT,
  ADD COLUMN "relationshipProfile" TEXT,
  ALTER COLUMN "displayName" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");
CREATE UNIQUE INDEX "User_lidJid_key" ON "User"("lidJid");
CREATE UNIQUE INDEX "User_pnJid_key" ON "User"("pnJid");
