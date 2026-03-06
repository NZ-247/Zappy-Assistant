-- CreateEnum
CREATE TYPE "TimerStatus" AS ENUM ('SCHEDULED', 'FIRED', 'FAILED', 'CANCELED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'member';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "groupId" TEXT,
ADD COLUMN "userId" TEXT,
ADD COLUMN "waUserId" TEXT,
ADD COLUMN "waGroupId" TEXT;

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "groupId" TEXT,
    "userId" TEXT,
    "waUserId" TEXT,
    "waGroupId" TEXT,
    "scope" "Scope" NOT NULL,
    "text" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "publicId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Timer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "groupId" TEXT,
    "userId" TEXT,
    "waUserId" TEXT,
    "waGroupId" TEXT,
    "fireAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "label" TEXT,
    "status" "TimerStatus" NOT NULL DEFAULT 'SCHEDULED',
    "sentMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Timer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_groupId_idx" ON "Task"("groupId");

-- CreateIndex
CREATE INDEX "Task_userId_idx" ON "Task"("userId");

-- CreateIndex
CREATE INDEX "Note_tenantId_idx" ON "Note"("tenantId");

-- CreateIndex
CREATE INDEX "Note_groupId_idx" ON "Note"("groupId");

-- CreateIndex
CREATE INDEX "Note_userId_idx" ON "Note"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Note_tenantId_publicId_key" ON "Note"("tenantId", "publicId");

-- CreateIndex
CREATE UNIQUE INDEX "Note_tenantId_scope_groupId_userId_sequence_key" ON "Note"("tenantId", "scope", "groupId", "userId", "sequence");

-- CreateIndex
CREATE INDEX "Timer_fireAt_idx" ON "Timer"("fireAt");

-- CreateIndex
CREATE INDEX "Timer_tenantId_idx" ON "Timer"("tenantId");

-- CreateIndex
CREATE INDEX "Timer_groupId_idx" ON "Timer"("groupId");

-- CreateIndex
CREATE INDEX "Timer_userId_idx" ON "Timer"("userId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timer" ADD CONSTRAINT "Timer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timer" ADD CONSTRAINT "Timer_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timer" ADD CONSTRAINT "Timer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
