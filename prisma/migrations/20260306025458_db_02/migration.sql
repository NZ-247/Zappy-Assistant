-- CreateEnum
CREATE TYPE "MemoryRole" AS ENUM ('system', 'user', 'assistant', 'tool');

-- CreateTable
CREATE TABLE "ConversationMemory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "waUserId" TEXT,
    "role" "MemoryRole" NOT NULL,
    "content" TEXT NOT NULL,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationMemory_conversationId_createdAt_idx" ON "ConversationMemory"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationMemory_tenantId_createdAt_idx" ON "ConversationMemory"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "ConversationMemory" ADD CONSTRAINT "ConversationMemory_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
