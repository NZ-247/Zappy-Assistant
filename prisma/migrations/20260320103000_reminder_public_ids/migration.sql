-- AlterTable
ALTER TABLE "Reminder"
ADD COLUMN "sequence" INTEGER,
ADD COLUMN "publicId" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill existing reminders with stable public IDs per tenant (RMD001, RMD002, ...)
WITH ranked AS (
  SELECT
    "id",
    "tenantId",
    ROW_NUMBER() OVER (
      PARTITION BY "tenantId"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS seq
  FROM "Reminder"
  WHERE "tenantId" IS NOT NULL
)
UPDATE "Reminder" AS r
SET
  "sequence" = ranked.seq,
  "publicId" = CONCAT('RMD', LPAD(ranked.seq::text, 3, '0'))
FROM ranked
WHERE r."id" = ranked."id"
  AND (r."sequence" IS NULL OR r."publicId" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_tenantId_publicId_key" ON "Reminder"("tenantId", "publicId");

-- Align with @updatedAt behavior
ALTER TABLE "Reminder" ALTER COLUMN "updatedAt" DROP DEFAULT;
