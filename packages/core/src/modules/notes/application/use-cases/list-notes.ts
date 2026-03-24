import type { NotesRepositoryPort, NoteRecord } from "../../ports.js";
import type { Scope } from "../../../../pipeline/types.js";

export interface ListNotesInput {
  tenantId: string;
  waGroupId?: string;
  waUserId: string;
  scope: Scope;
  limit?: number;
}

export const listNotes = async (notesRepository: NotesRepositoryPort, input: ListNotesInput): Promise<NoteRecord[]> => {
  return notesRepository.listNotes({
    tenantId: input.tenantId,
    waGroupId: input.waGroupId,
    waUserId: input.waUserId,
    scope: input.scope,
    limit: input.limit
  });
};
