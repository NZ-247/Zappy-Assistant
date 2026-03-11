-- CreateEnum
CREATE TYPE "FunMode" AS ENUM ('ON', 'OFF');

-- AlterTable
ALTER TABLE "Group"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "isOpen" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "welcomeEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "welcomeText" TEXT,
  ADD COLUMN "fixedMessageText" TEXT,
  ADD COLUMN "rulesText" TEXT,
  ADD COLUMN "funMode" "FunMode",
  ADD COLUMN "moderationConfig" JSONB NOT NULL DEFAULT '{}'::jsonb;
