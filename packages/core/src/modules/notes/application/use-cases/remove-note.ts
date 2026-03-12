import type { NotesRepositoryPort } from "../../ports/notes-repository.port.js";

export interface RemoveNoteInput {
  tenantId: string;
  waGroupId?: string;
  waUserId: string;
  publicId: string;
}

export const removeNote = async (notesRepository: NotesRepositoryPort, input: RemoveNoteInput): Promise<boolean> => {
  return notesRepository.removeNote({
    tenantId: input.tenantId,
    waGroupId: input.waGroupId,
    waUserId: input.waUserId,
    publicId: input.publicId
  });
};
