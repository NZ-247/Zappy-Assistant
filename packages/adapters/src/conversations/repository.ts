import { isSeededIdentityPair } from "../identity/canonical-identity.js";
import type { ConversationScope, ConversationMessage } from "@zappy/core";
import type { PrismaClient, Prisma, MessageDirection, MemoryRole } from "@prisma/client";

type Address = { scope: ConversationScope; conversationId: string };
type Entry = Address & { waUserId?: string; role: MemoryRole; content: string; metadataJson?: unknown; keepLatest?: number };
type Input = { tenantId: string; userId?: string; groupId?: string; waUserId: string; waGroupId?: string;
  text: string; waMessageId?: string; rawJson?: unknown; isGroup?: boolean };

function scopedWhere({ scope, conversationId }: Address) {
  if (!scope?.tenantId || !scope.ownerId || !conversationId || scope.channel !== "whatsapp" ||
      !["group", "direct"].includes(scope.chatType)) throw new Error("invalid_conversation_scope");
  return { tenantId: scope.tenantId, conversationId, conversation: { ...scope } };
}

async function lockConversation(tx: Prisma.TransactionClient, address: Address) {
  scopedWhere(address);
  const { scope, conversationId } = address;
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Conversation"
    WHERE id = ${conversationId} AND "tenantId" = ${scope.tenantId} AND channel = ${scope.channel}
      AND "chatType" = ${scope.chatType} AND "ownerId" = ${scope.ownerId} FOR UPDATE`;
  if (!rows.length) throw new Error("conversation_scope_mismatch");
}

const newest = [{ createdAt: "desc" }, { id: "desc" }] as const;
async function prune(tx: Prisma.TransactionClient, address: Address, keep: number) {
  if (!Number.isSafeInteger(keep) || keep < 0) throw new Error("invalid_memory_window");
  const where = scopedWhere(address);
  const retained = await tx.conversationMemory.findMany({ where, orderBy: [...newest], take: keep, select: { id: true } });
  await tx.conversationMemory.deleteMany({ where: { ...where, id: { notIn: retained.map(row => row.id) } } });
}

export function createConversationRepositories(prisma: PrismaClient) {
  async function persist(input: Input, direction: MessageDirection) {
    const { tenantId, waGroupId, waUserId } = input;
    const isGroup = Boolean(waGroupId);
    if (!tenantId || (input.isGroup !== undefined && input.isGroup !== isGroup) || (!isGroup && input.groupId))
      throw new Error("inconsistent_chat_type");

    return prisma.$transaction(async tx => {
      let userId = input.userId;
      let groupId: string | undefined;
      if (isGroup) {
        const group = await tx.group.findFirst({ where: { tenantId, waGroupId, id: input.groupId }, select: { id: true } });
        if (!group) throw new Error("unknown_group_scope");
        groupId = group.id;
        if (userId && !await tx.user.count({ where: { tenantId, id: userId } })) throw new Error("unknown_sender");
      } else {
        // Use identity columns only. Display names and historical free-form aliases are not proof of ownership.
        if (!waUserId) throw new Error("unknown_direct_owner");
        const normalized = waUserId.replace(/@c\.us$/, "@s.whatsapp.net");
        const matches = await tx.user.findMany({ where: { tenantId, OR: [
          { waUserId }, { waUserId: normalized }, { lidJid: normalized }, { pnJid: normalized }
        ] }, select: { id: true, waUserId: true, lidJid: true, phoneNumber: true }, take: 2 });
        const owner = matches[0];
        if (matches.length !== 1 || (userId && userId !== owner.id) ||
            (owner.waUserId.endsWith("@lid") && normalized === owner.waUserId.replace(/@lid$/, "@s.whatsapp.net")))
          throw new Error("ambiguous_direct_owner");
        if (owner.waUserId.replace(/@c\.us$/, "@s.whatsapp.net") !== normalized) {
          const { lidJid, phoneNumber } = owner;
          const proof = lidJid && phoneNumber && (isSeededIdentityPair(lidJid, phoneNumber) ||
            await tx.auditLog.count({ where: { action: "UPDATE", entity: "User", entityId: owner.id, AND: [
              { metadata: { path: ["action"], equals: "link_alias" } },
              { metadata: { path: ["lidJid"], equals: lidJid } },
              { metadata: { path: ["phoneNumber"], equals: phoneNumber } }
            ] } }));
          if (!proof) throw new Error("unverified_direct_alias");
        }
        userId = owner.id;
      }
      const scope: ConversationScope = { tenantId, channel: "whatsapp", chatType: isGroup ? "group" : "direct", ownerId: groupId ?? userId! };
      // Prisma emits PostgreSQL INSERT ... ON CONFLICT for this single-table upsert.
      const conversation = await tx.conversation.upsert({
        where: { tenantId_channel_chatType_ownerId: scope }, create: { ...scope, groupId }, update: { ownerId: scope.ownerId },
        select: { id: true }
      });
      return tx.message.create({ data: { tenantId, conversationId: conversation.id, userId, waUserId, waGroupId,
        direction, body: input.text, waMessageId: input.waMessageId, rawJson: (input.rawJson ?? {}) as Prisma.InputJsonValue } });
    });
  }

  async function listRecentMemory(input: Address & { limit: number }) {
    const rows = await prisma.conversationMemory.findMany({ where: scopedWhere(input), orderBy: [...newest], take: input.limit });
    return rows.reverse().map(row => ({ ...row, waUserId: row.waUserId ?? undefined }));
  }
  async function appendMemory(input: Entry) {
    const content = input.content.trim();
    if (!content || input.keepLatest === 0) return;
    await prisma.$transaction(async tx => {
      await lockConversation(tx, input);
      await tx.conversationMemory.create({ data: { tenantId: input.scope.tenantId, conversationId: input.conversationId,
        waUserId: input.waUserId, role: input.role, content, metadataJson: input.metadataJson as Prisma.InputJsonValue } });
      if (input.keepLatest !== undefined) await prune(tx, input, input.keepLatest);
    });
  }
  async function trimOldMemory(input: Address & { keep: number }) {
    await prisma.$transaction(async tx => { await lockConversation(tx, input); await prune(tx, input, input.keep); });
  }
  return {
    persistInboundMessage: (input: Input) => persist(input, "INBOUND"),
    persistOutboundMessage: (input: Input) => persist(input, "OUTBOUND"),
    messagesRepository: {
      async getRecentMessages(input: Address & { limit: number }): Promise<ConversationMessage[]> {
        const where = scopedWhere(input);
        const direct = input.scope.chatType === "direct" ? { userId: input.scope.ownerId, waGroupId: null } : {};
        const rows = await prisma.message.findMany({ where: { ...where, ...direct }, orderBy: [...newest], take: input.limit,
          select: { direction: true, body: true } });
        return rows.reverse().map(row => ({ role: row.direction === "INBOUND" ? "user" : "assistant", content: row.body }));
      }
    },
    conversationMemoryRepository: { listRecentMemory, loadRecent: listRecentMemory, appendMemory, trimOldMemory,
      append: (entry: Entry & { keep?: number }) => appendMemory({ ...entry, keepLatest: entry.keep }),
      clearMemory: (address: Address) => trimOldMemory({ ...address, keep: 0 }) }
  };
}
