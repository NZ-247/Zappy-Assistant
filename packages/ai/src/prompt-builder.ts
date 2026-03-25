import { getPersona } from "./persona.js";
import type { EffectiveSettings, PromptBuilderInput, PromptBuilderOutput, PersonaId } from "./types.js";

const DEFAULT_CONTEXT: EffectiveSettings = { formality: "neutral" };

const HARD_FACTS_GLOBAL = [
  "Your name is Zappy, the digital assistant created for this system. If asked your name, answer \"Zappy\" and never claim to lack a name.",
  "Phone number 556699064658 is the creator/root (also known as NZ_DEV). When recognized, treat this user as creator_root and ROOT; never describe them as a standard member/user.",
  "Phone number 556692283438 is mother_privileged. Treat her with a respectful, warm, affectionate tone.",
  "When permissionRole/userRole is ROOT you must acknowledge full privileges and never invent lower permissions."
];

const limitMemory = (input?: { items?: PromptBuilderInput["recentMemory"]; limit?: number }) => {
  if (!input?.items?.length) return [];
  if (!input.limit || input.limit <= 0) return input.items;
  return input.items.slice(-input.limit);
};

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

const buildToneBlock = (input: PromptBuilderInput, languageHint?: string): string => {
  const { persona, chatScope, userRole, relationshipProfile, profileModifier, userDisplayName } = input;
  const toneLines: string[] = [];

  toneLines.push(`Style: ${persona.traits.join(", ")}.`);
  toneLines.push(`Tone for clients/third parties: ${persona.tone.client}.`);
  toneLines.push(`Tone for owner/root: ${persona.tone.owner}.`);
  if (relationshipProfile) {
    toneLines.push(
      `Relationship profile: ${relationshipProfile}${profileModifier?.summary ? ` — ${profileModifier.summary}` : ""}.`
    );
  }
  if (profileModifier?.affectionateForms?.length) {
    toneLines.push(`Allowed soft forms of address (use sparingly): ${profileModifier.affectionateForms.join(", ")}.`);
  }
  if (relationshipProfile === "creator_root") {
    toneLines.push(
      "Creator/root detected (NZ_DEV). Be strategic, proactive, slightly playful, and complementary like a smart child helping a father figure; volunteer helpful ideas."
    );
  }
  if (relationshipProfile === "mother_privileged") {
    toneLines.push(
      "Mother_privileged detected. Keep replies sweet, respectful, warm, and gently admiring; affectionate but never romantic. Soft nicknames allowed sparingly."
    );
  }
  toneLines.push(
    `Conversation scope: ${chatScope === "direct" ? "Direct chat — be a personal assistant." : "Group chat — be concise and contextual."}`
  );
  toneLines.push(
    `User role: ${userRole}. ${["ROOT", "DONO"].includes(userRole) ? "Can be more direct and operational." : "Keep professional clarity."}`
  );
  toneLines.push(
    `When directly addressing the user, prefer "${userDisplayName?.trim() || "você"}" and never use internal role labels as a name (ROOT, creator_root, bot_admin, group_admin, admin).`
  );
  if (languageHint) toneLines.push(`Language preference: ${languageHint}.`);
  return toneLines.join(" ");
};

const buildBehaviorBlock = (input: PromptBuilderInput): string | null => {
  const behavior = input.persona.behavior;
  const parts: string[] = [];
  if (behavior.initiativeLevel) parts.push(`Initiative: ${behavior.initiativeLevel}.`);
  if (behavior.creativityLevel) parts.push(`Creativity: ${behavior.creativityLevel}.`);
  if (behavior.suggestionTone) parts.push(`Suggestions: ${behavior.suggestionTone}.`);
  if (behavior.uncertaintyPolicy) parts.push(`Uncertainty: ${behavior.uncertaintyPolicy}`);
  return parts.length ? parts.join(" ") : null;
};

const buildOperationalPolicies = (input: PromptBuilderInput): string[] => {
  const policies: string[] = [
    "Prefer clarity over verbosity; keep replies actionable and concise.",
    "Avoid overexplaining and do not invent facts.",
    "If information depends on tools or data you do not have, say so and suggest the relevant command or data needed.",
    "If a command/tool can solve the request, suggest or invoke it; otherwise provide a concise answer.",
    "Use current timezone and local date/time in replies when relevant.",
    "If LLM cannot fulfill a request, redirect to available commands gracefully.",
    "Do not use internal permission/profile labels as vocative names for the user."
  ];

  if (input.handoffActive) policies.push("Handoff is active; stay silent unless explicitly mentioned by name.");
  if (input.chatScope === "group") policies.push("In groups, keep messages short and clearly reference context.");
  if (input.chatScope === "direct") policies.push("In direct chats, be slightly warmer and offer to organize next steps.");

  return policies;
};

const buildToolHints = (input: PromptBuilderInput): string[] => {
  const hints: string[] = [];
  if (input.modulesEnabled?.length) hints.push(`Modules enabled: ${input.modulesEnabled.join(", ")}.`);
  if (input.availableTools?.length)
    hints.push(`Tools available: ${input.availableTools.join(", ")}. Prefer suggesting them when they address the request.`);
  return hints;
};

export const buildPrompt = (input: PromptBuilderInput): PromptBuilderOutput => {
  const settings = { ...DEFAULT_CONTEXT, ...input.settings };
  const memory = limitMemory({ items: input.recentMemory, limit: input.memoryLimit });
  const contextMessages = convertMemoryToMessages(memory);
  const systemLines: string[] = [];

  // 1) Identity / persona
  systemLines.push(input.persona.description ?? `You are ${input.persona.name} (persona id: ${input.persona.id}).`);

  // 2) Role & responsibilities
  systemLines.push(`Role: ${input.persona.role}`);

  // 3) Tone / style
  systemLines.push(buildToneBlock(input, settings.language));
  const behaviorBlock = buildBehaviorBlock(input);
  if (behaviorBlock) systemLines.push(behaviorBlock);
  if (input.profileModifier?.promptAdditions?.length) systemLines.push(input.profileModifier.promptAdditions.join(" "));

  // 3.1) Hard Facts — non-negotiable
  const hardFacts = buildHardFactsBlock(input);
  if (hardFacts) systemLines.push(hardFacts);

  // 4) Operational policies
  systemLines.push(buildOperationalPolicies(input).join(" "));

  // 5) Conversation context
  const contextBits: string[] = [];
  if (input.currentState) contextBits.push(`Conversation state: ${input.currentState}.`);
  if (input.chatScope === "group") contextBits.push("Respond to the sender; avoid noisy replies.");
  if (contextBits.length) systemLines.push(contextBits.join(" "));

  // 6) Tools / modules
  const toolHints = buildToolHints(input);
  if (toolHints.length) systemLines.push(toolHints.join(" "));

  // 7) Current date/time/timezone
  systemLines.push(
    `Current datetime: ${input.now.toISOString()}. Timezone: ${settings.timezone ?? "unspecified"}.${
      settings.formality ? ` Formality: ${settings.formality}.` : ""
    }`
  );

  // 8) Output behavior expectations
  systemLines.push(
    "Output expectations: be concise, structured, and actionable. If uncertain, say so briefly. When proposing steps, list them in 1-3 bullets."
  );

  if (input.policyNotes?.length) systemLines.push(input.policyNotes.join(" "));

  const systemPrompt = systemLines.join("\n");

  return {
    systemPrompt,
    contextMessages,
    policyNotes: input.policyNotes,
    toolHints,
    profileSummary: input.profileModifier?.summary
  };
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
    relationshipProfile: undefined,
    now: input?.now ?? new Date(),
    recentMemory: [],
    availableTools: [],
    policyNotes: input?.policyNotes ?? []
  });
  return prompt.systemPrompt;
};

export const buildSystemPrompt = buildBaseSystemPrompt;

function buildHardFactsBlock(input: PromptBuilderInput): string {
  const facts = [...HARD_FACTS_GLOBAL];
  if (input.relationshipProfile === "creator_root") {
    facts.push("Current user recognized as creator_root (NZ_DEV). Treat as ROOT with full control and acknowledge the creator role when relevant.");
  }
  if (input.relationshipProfile === "mother_privileged") {
    facts.push("Current user recognized as mother_privileged. Maintain respectful, warm, affectionate tone and gentle admiration.");
  }
  if (["ROOT", "DONO"].includes(input.userRole)) {
    facts.push("Runtime userRole indicates ROOT ownership; reflect full administrative privileges when permissions are discussed.");
  }
  const lines = ["HARD FACTS (non-negotiable — never contradict):", ...facts.map((fact) => `- ${fact}`)];
  return lines.join("\n");
}
