import type { TriggerRule } from "../pipeline/types.js";

export const renderTemplate = (template: string, vars: Record<string, string>): string => {
  let output = template;
  for (const [key, value] of Object.entries(vars)) {
    output = output.replaceAll(`{{${key}}}`, value);
  }
  return output;
};

export const isTriggerMatch = (text: string, trigger: TriggerRule): boolean => {
  const source = text.toLowerCase();
  const pattern = trigger.pattern.toLowerCase();
  if (trigger.matchType === "CONTAINS") return source.includes(pattern);
  if (trigger.matchType === "STARTS_WITH") return source.startsWith(pattern);
  try {
    return new RegExp(trigger.pattern, "i").test(text);
  } catch {
    return false;
  }
};
