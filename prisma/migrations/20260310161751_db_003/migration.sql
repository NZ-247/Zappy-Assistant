-- CreateEnum
CREATE TYPE "ChatMode" AS ENUM ('ON', 'OFF');

-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "allowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "botAdminCheckedAt" TIMESTAMP(3),
ADD COLUMN     "botIsAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "chatMode" "ChatMode" NOT NULL DEFAULT 'ON';

-- CreateTable
CREATE TABLE "BotAdmin" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "waUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotAdmin_tenantId_idx" ON "BotAdmin"("tenantId");

-- CreateIndex
CREATE INDEX "BotAdmin_userId_idx" ON "BotAdmin"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BotAdmin_tenantId_waUserId_key" ON "BotAdmin"("tenantId", "waUserId");

-- AddForeignKey
ALTER TABLE "BotAdmin" ADD CONSTRAINT "BotAdmin_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotAdmin" ADD CONSTRAINT "BotAdmin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
