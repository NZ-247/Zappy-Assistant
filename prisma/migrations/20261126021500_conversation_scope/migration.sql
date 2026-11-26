BEGIN;
-- Null scope identifies legacy conversations outside prompt retrieval.
ALTER TABLE "Conversation" ADD COLUMN "channel" TEXT, ADD COLUMN "chatType" TEXT, ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_scope_shape" CHECK (
  ("channel" IS NULL AND "chatType" IS NULL AND "ownerId" IS NULL) OR
  ("channel" IS NOT NULL AND "channel" = 'whatsapp' AND "chatType" IS NOT NULL AND
   "ownerId" IS NOT NULL AND length("ownerId") > 0 AND
   (("chatType" = 'direct' AND "groupId" IS NULL) OR ("chatType" = 'group' AND "groupId" IS NOT NULL AND "ownerId" = "groupId"))));
DROP INDEX "Conversation_tenantId_groupId_key";
CREATE UNIQUE INDEX "Conversation_tenantId_channel_chatType_ownerId_key" ON "Conversation" ("tenantId","channel","chatType","ownerId");
CREATE UNIQUE INDEX "Conversation_tenantId_id_key" ON "Conversation" ("tenantId","id");
ALTER TABLE "ConversationMemory" DROP CONSTRAINT "ConversationMemory_conversationId_fkey",
  ADD FOREIGN KEY ("tenantId","conversationId") REFERENCES "Conversation" ("tenantId","id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "Message" DROP CONSTRAINT "Message_conversationId_fkey",
  ADD FOREIGN KEY ("tenantId","conversationId") REFERENCES "Conversation" ("tenantId","id") ON UPDATE CASCADE ON DELETE CASCADE;
COMMIT;
