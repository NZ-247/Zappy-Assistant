import type { ResponseAction } from "../../../../pipeline/actions.js";
import type { RemindersRepositoryPort } from "../../ports/reminder-repository.port.js";
import type { ReminderCreateInput } from "../../../../pipeline/types.js";

export interface CreateReminderInput extends ReminderCreateInput {
  pretty: string;
  timezone: string;
}

export const createReminder = async (
  remindersRepository: RemindersRepositoryPort,
  input: CreateReminderInput
): Promise<ResponseAction[]> => {
  const reminder = await remindersRepository.createReminder({
    tenantId: input.tenantId,
    waUserId: input.waUserId,
    waGroupId: input.waGroupId,
    message: input.message,
    remindAt: input.remindAt
  });

  return [
    { kind: "reply_text", text: `Reminder ${reminder.id} set for ${input.pretty} (${input.timezone})` },
    { kind: "enqueue_job", jobType: "reminder", payload: { id: reminder.id, runAt: input.remindAt } }
  ];
};
