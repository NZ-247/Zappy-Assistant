import { getPersona } from "./persona.js";
import type { EffectiveSettings, PromptBuilderInput, PromptBuilderOutput, PersonaId } from "./types.js";

const DEFAULT_CONTEXT: EffectiveSettings = { formality: "neutral" };

const convertMemoryToMessages = (input: PromptBuilderInput["recentMemory"]): PromptBuilderOutput["contextMessages"] => {
  if (!input?.length) return [];
  return input
    .map((item) => {
      if (item.role === "tool") return null;
      const role = item.role === "system" ? "system" : item.role === "assistant" ? "assistant" : "user";
      return { role, content: item.content };
    })
    .filter(Boolean) as PromptBuilderOutput["contextMessages"];
};

export const buildPrompt = (input: PromptBuilderInput): PromptBuilderOutput => {
  const settings = { ...DEFAULT_CONTEXT, ...input.settings };
  const lines: string[] = [];

  lines.push(input.persona.description ?? `You are ${input.persona.name}.`);
  lines.push(`Role: ${input.persona.role}`);
  lines.push(`Chat scope: ${input.chatScope}. User role: ${input.userRole}.`);
  lines.push(`Now: ${input.now.toISOString()}.`);
  if (settings.timezone) lines.push(`Timezone: ${settings.timezone}.`);
  if (settings.language) lines.push(`Preferred language: ${settings.language}.`);
  if (settings.formality) lines.push(`Formality: ${settings.formality}.`);
  if (input.policyNotes?.length) lines.push(...input.policyNotes);

  const systemPrompt = lines.join("\n");
  const contextMessages = convertMemoryToMessages(input.recentMemory);

  return { systemPrompt, contextMessages, policyNotes: input.policyNotes };
};

export const buildBaseSystemPrompt = (input?: {
  personaId?: PersonaId;
  settings?: EffectiveSettings;
  now?: Date;
  policyNotes?: string[];
}): string => {
  const persona = getPersona(input?.personaId);
  const prompt = buildPrompt({
    persona,
    settings: { ...DEFAULT_CONTEXT, ...input?.settings },
    chatScope: "direct",
    userRole: "MEMBER",
    now: input?.now ?? new Date(),
    recentMemory: [],
    activeTools: [],
    policyNotes: input?.policyNotes ?? []
  });
  return prompt.systemPrompt;
};

export const buildSystemPrompt = buildBaseSystemPrompt;
