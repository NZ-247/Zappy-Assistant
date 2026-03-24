import { Scope, type Prisma, type PrismaClient } from "@prisma/client";
import { createPublicIdCodec } from "../infrastructure/public-id.js";
import type { ScopedResolver } from "../shared/scoped-resolver.js";

export interface NotesRepositoryDeps {
  prisma: PrismaClient;
  resolveScopedUserAndGroup: ScopedResolver;
}

const notePublicIdCodec = createPublicIdCodec("N", { strictNumericSequence: true });

export const createNotesRepository = (deps: NotesRepositoryDeps) => {
  const { prisma, resolveScopedUserAndGroup } = deps;

  return {
    addNote: async (input: { tenantId: string; waGroupId?: string; waUserId: string; text: string; scope: Scope }) => {
      const { user, group } = await resolveScopedUserAndGroup({
        tenantId: input.tenantId,
        waUserId: input.waUserId,
        waGroupId: input.waGroupId
      });
      const last = await prisma.note.findFirst({
        where: { tenantId: input.tenantId, scope: input.scope, groupId: group?.id ?? null, userId: user?.id ?? null },
        orderBy: { sequence: "desc" }
      });
      const nextSeq = (last?.sequence ?? 0) + 1;
      const publicId = notePublicIdCodec.formatFromSequence(nextSeq);
      const row = await prisma.note.create({
        data: {
          tenantId: input.tenantId,
          groupId: group?.id,
          userId: user?.id,
          waGroupId: input.waGroupId,
          waUserId: input.waUserId,
          scope: input.scope,
          text: input.text,
          sequence: nextSeq,
          publicId
        }
      });
      return { id: row.id, publicId: row.publicId, text: row.text, createdAt: row.createdAt, scope: row.scope as Scope };
    },

    listNotes: async (input: { tenantId: string; waGroupId?: string; waUserId: string; scope: Scope; limit?: number }) => {
      const { user, group } = await resolveScopedUserAndGroup({
        tenantId: input.tenantId,
        waUserId: input.waUserId,
        waGroupId: input.waGroupId
      });
      const rows = await prisma.note.findMany({
        where: { tenantId: input.tenantId, scope: input.scope, groupId: group?.id ?? null, userId: user?.id ?? null },
        orderBy: { createdAt: "desc" },
        take: input.limit ?? 10
      });
      return rows.map((row) => ({ id: row.id, publicId: row.publicId, text: row.text, createdAt: row.createdAt, scope: row.scope as Scope }));
    },

    removeNote: async (input: { tenantId: string; waGroupId?: string; waUserId: string; publicId: string }) => {
      const { user, group } = await resolveScopedUserAndGroup({
        tenantId: input.tenantId,
        waUserId: input.waUserId,
        waGroupId: input.waGroupId
      });
      const note = await prisma.note.findFirst({
        where: { tenantId: input.tenantId, publicId: input.publicId, groupId: group?.id ?? null, userId: user?.id ?? null }
      });
      if (!note) return false;
      await prisma.note.delete({ where: { id: note.id } });
      return true;
    }
  };
};
