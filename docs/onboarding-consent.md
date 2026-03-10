# Onboarding & Consent (Services.NET)

This flow keeps common users gated until they accept the Services.NET terms while letting privileged profiles work normally.

## Data model
- `UserConsent` (`tenantId`, `userId`, `status: PENDING|ACCEPTED|DECLINED`, `termsVersion`, `acceptedAt`, `declinedAt`, `source`, timestamps)
- Unique per `tenantId + userId + termsVersion`; stored via Prisma.

## Flow
1) First inbound message from a non-privileged user → status set to `PENDING`, state `WAITING_CONSENT` saved in conversation state.  
   The user receives the onboarding text: link `CONSENT_LINK` (default `https://services.net.br/politicas`) and instructions to reply `SIM` or `NÃO`.
2) While pending, only these inputs are handled: `SIM`, `NÃO`, `ajuda`, `terms/termos`, `política/politica` (and `/help` as help). Any other message returns a reminder and keeps tools/AI blocked.
3) `SIM` → status `ACCEPTED`, timestamp saved, consent gate removed, confirmation sent: “Consentimento registrado... suporte / orçamento / agendamento / dúvidas.”
4) `NÃO` → status `DECLINED`, gate stays active, polite refusal sent; user can still change to `SIM` later.
5) Conversation state expiry uses the same 10‑minute TTL as other pending flows; state is cleared on accept.

## Bypass rules
- Never gated: relationship profiles `creator_root`, `mother_privileged`, `delegated_owner`; permission roles `ROOT`, `DONO/OWNER`, `ADMIN`, `PRIVILEGED`, `INTERNAL`.
- These profiles skip consent onboarding and go straight to normal triggers/AI.
- creator_root also skips the generic greeting to allow persona-first behaviour.

## Greeting after consent
- For common users with consent: short Services.NET greeting replaces the old generic `/help` prompt:  
  “Olá! Sou Zappy, assistente digital da Services.NET. Posso ajudar com suporte, orçamento, agendamento ou dúvidas. Como posso ajudar?”
- Greeting is rate-limited (cooldown key `greeting:<tenant>:<scope>` for 3 minutes) to avoid spam.
- Guardrails (Mar/2026): only fire on isolated greetings (`oi`, `olá`, `bom dia`, `boa tarde`, `boa noite`); skip if the chat already has prior messages, if the sender is creator_root/mother_privileged/delegated_owner/ROOT, or if the text looks like contextual small talk (`bele`, `beleza`, `tá`, `joia`, `kk`). In those cases the flow prefers normal triggers/AI instead of the generic greeting.

## Manual test checklist
1) Brand-new user sends “Oi” → receives onboarding consent text.
2) User replies “SIM” → consent stored as `ACCEPTED`, receives confirmation/unlocked message; next messages use normal flow.
3) User replies “NÃO” → stored as `DECLINED`, remains blocked with polite reminder.
4) creator_root user flows without any consent prompt.
5) mother_privileged user flows without consent prompt.
