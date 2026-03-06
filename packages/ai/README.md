# @zappy/ai — AI Persona & Prompt Builder

This package hosts the AI-facing building blocks for Zappy: persona definitions, prompt construction, and (later) conversation memory and routing. It stays framework-free and does not depend on the OpenAI SDK; adapters live elsewhere.

## Persona: `secretary_default`
- Traits: friendly, polite, slightly formal, organized, concise, proactive, helpful, calm, respectful.
- Role: Alan's digital secretary — organize tasks, reminders, notes, schedules; guide conversations with professionalism; warm but not overly casual. Business tone with customers/third parties; more direct/operational with ROOT/owner.
- Behaviors: prefer clarity over verbosity; keep replies actionable; avoid overexplaining; never invent facts; if data depends on tools, say so; suggest commands/tools when they solve the request; use current timezone/date in replies; if LLM can’t fulfill, redirect to available commands.
- Example styles:
  - Direct PA: “Claro, já agendo isso e te lembro 30 minutos antes. Quer que eu também crie uma tarefa para acompanhar?”
  - Business/client: “Boa tarde! Posso confirmar o horário das 15h (GMT-3) para a reunião. Caso prefira outro horário, me avise e ajusto.”
  - Operational summary: “Resumo rápido: 3 tarefas abertas para hoje, 1 lembrete às 17:30, nenhuma pendência crítica. Posso priorizar algo?”

## Prompt builder (structure)
Inputs include: persona, current datetime/timezone/language/formality, conversationScope (direct|group), userRole (ROOT|DONO|GROUP_ADMIN|ADMIN|MEMBER), modules enabled, available tools, conversation state, handoff flag, recent memory (already trimmed), policy notes.

Output sections:
1) Identity/persona
2) Role and responsibilities
3) Tone/style (scope- and role-aware)
4) Operational policies (clarity, no hallucination, tool-first, timezone usage, handoff rules)
5) Conversation context (scope + optional state)
6) Tools/modules available (only those provided)
7) Current date/time/timezone + formality
8) Output expectations (concise, actionable, acknowledge uncertainty)

`contextMessages` are built from recent memory (respecting the provided limit) and exclude tool-role items.

## Example prompts (truncated)
- Direct chat, ROOT: includes warmer assistant tone, direct/operational wording, tool hints, and current datetime/timezone.
- Group chat, MEMBER: adds “be concise/noisy” note, professional tone, shorter replies; tool hints only if supplied.

See `buildPrompt` in `src/prompt-builder.ts` for the exact assembly.

## Memory vs raw messages
- Raw `Message` rows keep the full audit trail.
- `ConversationMemory` stores only AI-relevant, trimmed turns (user/assistant/system/tool summaries) with a short retention window (`LLM_MEMORY_MESSAGES`, default 10).
- On each AI exchange, recent memory is loaded (chronological), user + assistant turns are appended, and older rows are trimmed to keep the window small. This keeps prompts focused while preserving audit history separately.

## AI result types & tool intents
- `AiTextReply`: normal text answer.
- `AiToolIntent`: suggestion to use a tool (`create_task`, `list_tasks`, `create_reminder`, `list_reminders`, `add_note`, `list_notes`, `get_time`, `get_settings`) with optional helper text; orchestrator decides whether to execute.
- `AiFallback`: safe fallback text when LLM/tooling is unavailable.

## Runtime config
- `LLM_ENABLED` toggles AI usage.
- `LLM_MODEL` / `OPENAI_MODEL` select the model; `LLM_PERSONA` picks the persona id.
- `LLM_MEMORY_MESSAGES` controls how many memory rows feed the prompt.
- `BOT_TIMEZONE` informs prompt and reminder formatting.

## Manual smoke checks
1) LLM disabled: set `LLM_ENABLED=false`, ask “Qual o status do bot?” → should respond with fallback text (no crash).
2) LLM enabled simple Q: ask “Me lembre de enviar o relatório amanhã” → should suggest a reminder tool intent with a short message.
3) LLM enabled general Q: ask “Qual a agenda de hoje?” → should produce text reply.
4) Group chat: send request in group; response should be concise and contextual.
