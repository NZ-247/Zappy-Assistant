import type { NotesRepositoryPort } from "../../ports/notes-repository.port.js";
import type { Scope } from "../../../../pipeline/types.js";

export interface AddNoteInput {
  tenantId: string;
  waGroupId?: string;
  waUserId: string;
  text: string;
  scope: Scope;
}

export const addNote = async (notesRepository: NotesRepositoryPort, input: AddNoteInput) => {
  return notesRepository.addNote({
    tenantId: input.tenantId,
    waGroupId: input.waGroupId,
    waUserId: input.waUserId,
    text: input.text,
    scope: input.scope
  });
};
