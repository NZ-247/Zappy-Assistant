import { formatDateTimeInZone } from "../../../time.js";
import type { ReminderRecord, TaskListItem } from "../../../pipeline/types.js";

export const formatAgenda = (input: {
  dateLabel: string;
  timezone: string;
  tasks: TaskListItem[];
  reminders: ReminderRecord[];
}): string => {
  const lines: string[] = [`📅 Agenda ${input.dateLabel} (${input.timezone})`];
  lines.push("\nTarefas:");
  if (input.tasks.length === 0) {
    lines.push("- Nenhuma tarefa para hoje.");
  } else {
    lines.push(
      ...input.tasks.map((task) => {
        const timePart = task.runAt ? ` @ ${formatDateTimeInZone(task.runAt, input.timezone)}` : "";
        return `${task.done ? "✅" : "⬜"} ${task.publicId}: ${task.title}${timePart}`;
      })
    );
  }

  lines.push("\nLembretes:");
  if (input.reminders.length === 0) {
    lines.push("- Nenhum lembrete para hoje.");
  } else {
    lines.push(
      ...input.reminders.map((reminder) => {
        const timePart = reminder.remindAt ? formatDateTimeInZone(reminder.remindAt, input.timezone) : "";
        return `⏰ ${reminder.publicId} ${timePart} - ${reminder.message ?? "(sem mensagem)"}`;
      })
    );
  }

  return lines.join("\n");
};
