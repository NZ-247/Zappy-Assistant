import type { PipelineContext } from "../../../../pipeline/context.js";
import type { ResponseAction } from "../../../../pipeline/actions.js";
import type { NotesRepositoryPort } from "../../ports/notes-repository.port.js";
import { addNote } from "../../application/use-cases/add-note.js";
import { listNotes } from "../../application/use-cases/list-notes.js";
import { removeNote } from "../../application/use-cases/remove-note.js";

const truncate = (text: string, max = 50): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

type NoteCommandKey = "note add" | "note list" | "note rm";

export interface NoteCommandDeps {
  notesRepository?: NotesRepositoryPort;
  formatUsage?: (command: NoteCommandKey) => string | null;
}

export const handleNoteCommand = async (input: {
  commandKey: string;
  cmd: string;
  ctx: PipelineContext;
  deps: NoteCommandDeps;
}): Promise<ResponseAction[] | null> => {
  const { commandKey, cmd, ctx, deps } = input;
  if (!["note add", "note list", "note rm"].includes(commandKey)) return null;

  const notesRepository = deps.notesRepository;
  if (!notesRepository) return [{ kind: "reply_text", text: "Notes module is not available." }];
  const key = commandKey as NoteCommandKey;

  if (key === "note add") {
    const usage = deps.formatUsage?.("note add");
    const text = cmd.replace(/^(note\s+add)\s+/i, "").replace(/^(note|notes)\s+/i, "").trim();
    if (!text) return [{ kind: "reply_text", text: usage ?? "Note text is required." }];
    const note = await addNote(notesRepository, {
      tenantId: ctx.event.tenantId,
      waGroupId: ctx.event.waGroupId,
      waUserId: ctx.event.waUserId,
      text,
      scope: ctx.scope.scope
    });
    return [{ kind: "reply_text", text: `Nota ${note.publicId} salva.` }];
  }

  if (key === "note list") {
    const notes = await listNotes(notesRepository, {
      tenantId: ctx.event.tenantId,
      waGroupId: ctx.event.waGroupId,
      waUserId: ctx.event.waUserId,
      scope: ctx.scope.scope,
      limit: 10
    });
    if (notes.length === 0) return [{ kind: "reply_text", text: "Nenhuma nota ainda." }];
    return [
      {
        kind: "reply_list",
        header: "Notas",
        items: notes.map((n) => ({ title: n.publicId, description: truncate(n.text, 50) }))
      }
    ];
  }

  if (key === "note rm") {
    const usage = deps.formatUsage?.("note rm");
    const publicId = cmd.replace(/^(note|notes)\s+rm\s+/i, "").trim().toUpperCase();
    if (!publicId) return [{ kind: "reply_text", text: usage ?? "Informe o ID da nota (ex: N001)." }];
    const removed = await removeNote(notesRepository, {
      tenantId: ctx.event.tenantId,
      waGroupId: ctx.event.waGroupId,
      waUserId: ctx.event.waUserId,
      publicId
    });
    return [{ kind: "reply_text", text: removed ? `Nota ${publicId} removida.` : `Nota ${publicId} não encontrada.` }];
  }

  return null;
};
